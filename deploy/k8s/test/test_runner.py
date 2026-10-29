#!/usr/bin/env python3
"""공개 shell 인터페이스 계약. 실제 kubectl/클러스터는 호출하지 않는다."""
import contextlib
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parent
MOCK = '''#!/usr/bin/env python3
import io,json,os,sys,tarfile
from pathlib import Path
args=sys.argv[1:]; root=Path(os.environ['MOCK_ROOT']); mode=os.environ.get('MOCK_MODE','pass')
with (root/'calls').open('a') as f: f.write(json.dumps(args)+'\\n')
if 'create' in args:
    (root/'manifest').write_text(sys.stdin.read()); print('job.batch/mock'); sys.exit(0)
if 'get' in args and 'pods' in args:
    n=int((root/'polls').read_text()) if (root/'polls').exists() else 0
    (root/'polls').write_text(str(n+1))
    status={} if mode=='queue' else {'containerStatuses':[{'name':'runner','state':{'running':{}}}]}
    print(json.dumps({'items':[] if mode=='queue' else [{'metadata':{'name':'mock-pod'},'status':status}]})); sys.exit(0)
if 'delete' in args:
    (root/'deleted').touch(); sys.exit(0)
if mode=='notfound' and 'get' in args and 'job' in args:
    print('Error from server (NotFound): jobs.batch "mock" not found', file=sys.stderr); sys.exit(1)
if 'get' in args and 'job' in args:
    if (root/'deleted').exists() and '--ignore-not-found' in args: sys.exit(0)
    if mode=='postcreate-error' and not (root/'failed-job-get').exists() and '--ignore-not-found' not in args:
        (root/'failed-job-get').touch(); sys.exit(1)
    done=(root/'released').exists()
    if done and mode=='delayed':
        n=int((root/'terminal-polls').read_text()) if (root/'terminal-polls').exists() else 0
        (root/'terminal-polls').write_text(str(n+1)); done=n>=3
    print(json.dumps({'metadata':{'name':'mock'},'status':{'conditions':[{'type':'Failed' if mode=='fail' else 'Complete','status':'True'}] if done else []}})); sys.exit(0)
if 'get' in args and 'events' in args:
    print(json.dumps({'items':[{'reason':'FailedCreate','message':'exceeded quota: test'}]})); sys.exit(0)
if 'exec' in args:
    if 'cat' in args:
        if mode=='running': sys.exit(1)
        print('7' if mode=='fail' else '0'); sys.exit(0)
    if 'tar' in args:
        if mode=='copyfail': sys.exit(9)
        with tarfile.open(fileobj=sys.stdout.buffer,mode='w|') as t:
            info=tarfile.TarInfo('.'); info.type=tarfile.DIRTYPE; t.addfile(info)
            data=json.dumps({'exit_code':7 if mode=='fail' else 0,'phases':{'prep':1,'install':2,'services':3,'test':4}}).encode()
            info=tarfile.TarInfo('runner-summary.json'); info.size=len(data); t.addfile(info,io.BytesIO(data))
            data=b'trace evidence'; info=tarfile.TarInfo('test-results/trace.zip'); info.size=len(data); t.addfile(info,io.BytesIO(data))
        sys.exit(0)
    if 'touch' in args: (root/'released').touch(); sys.exit(0)
if 'logs' in args: print('runner log'); sys.exit(0)
print('{}')
'''


class RunnerContract(unittest.TestCase):
    def invoke(self, mode='pass', extra=()):
        self.tmp = tempfile.TemporaryDirectory(prefix='runner-contract-', dir=os.environ.get('RUNNER_TEST_TMPDIR'))
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        mock = root / 'kubectl'
        mock.write_text(MOCK)
        mock.chmod(0o755)
        self.artifacts = root / 'output'
        self.root = root
        if mode == 'oldsource':
            source=root/'oldsource'
            (source/'deploy/k8s/test').mkdir(parents=True)
            (source/'pnpm-lock.yaml').write_text('lockfileVersion: 9.0')
            (source/'deploy/k8s/test/job.tmpl.yaml').write_text('memory: 10Gi')
            extra=('-w',str(source),*extra)
        env = dict(os.environ, PATH=str(root)+os.pathsep+os.environ['PATH'], MOCK_ROOT=str(root), MOCK_MODE=mode)
        return subprocess.run([str(HERE/'run-tests.sh'), '-a', str(self.artifacts), '-q', '1', '-t', '1', '-p', '0.02', *extra, 'printf', '%s', 'a b; literal'], env=env, text=True, capture_output=True, timeout=12)

    def test_postcreate_api_error_cancels_own_job(self):
        result = self.invoke('postcreate-error')
        self.assertEqual(result.returncode, 70, result.stderr+result.stdout)
        summary = json.loads((self.artifacts/'summary.json').read_text())
        self.assertEqual(summary['outcome'], 'infrastructure_error')
        self.assertEqual(summary['error'], 'kubectl get 실패: job mock')
        self.assertTrue(summary['job_cancelled'])
        self.assertTrue((self.root/'deleted').exists())
        calls = [json.loads(line) for line in (self.root/'calls').read_text().splitlines()]
        delete = next(i for i, call in enumerate(calls) if 'delete' in call)
        verify = next(i for i, call in enumerate(calls) if 'get' in call and '--ignore-not-found' in call)
        self.assertLess(delete, verify)
        self.assertIsNone(summary['runner'])

    def test_success_collects_before_release_and_reports_timings(self):
        result = self.invoke()
        self.assertEqual(result.returncode, 0, result.stderr+result.stdout)
        summary = json.loads((self.artifacts/'summary.json').read_text())
        self.assertEqual(summary['outcome'], 'passed')
        self.assertEqual(summary['runner']['phases']['test'], 4)
        self.assertGreaterEqual(summary['queue_seconds'], 0)
        self.assertTrue((self.artifacts/'test-results/trace.zip').exists())
        self.assertIn('runner log', (self.artifacts/'runner.log').read_text())
        calls = [json.loads(line) for line in (self.root/'calls').read_text().splitlines()]
        archive = next(i for i,c in enumerate(calls) if 'tar' in c)
        release = next(i for i,c in enumerate(calls) if 'touch' in c)
        self.assertLess(archive, release)

    def test_real_job_terminal_is_awaited_after_runner_releases(self):
        result=self.invoke('delayed')
        self.assertEqual(result.returncode,0,result.stderr+result.stdout)
        self.assertEqual((self.root/'terminal-polls').read_text(),'4')

    def test_exact_runner_exit_code_is_returned_after_job_failure(self):
        result = self.invoke('fail')
        self.assertEqual(result.returncode, 7, result.stderr+result.stdout)
        self.assertEqual(json.loads((self.artifacts/'summary.json').read_text())['outcome'], 'failed')

    def test_quota_queue_has_bounded_timeout_and_diagnostics(self):
        result = self.invoke('queue')
        self.assertEqual(result.returncode, 124, result.stderr+result.stdout)
        summary=json.loads((self.artifacts/'summary.json').read_text())
        self.assertEqual(summary['outcome'], 'queue_timeout')
        self.assertTrue(summary['job_cancelled'])
        self.assertIn('EXIT 124', result.stdout)
        self.assertIn('exceeded quota', (self.artifacts/'events.json').read_text())

    def test_artifact_copy_failure_is_not_reported_as_pass(self):
        result=self.invoke('copyfail')
        self.assertEqual(result.returncode,74,result.stderr+result.stdout)
        self.assertEqual(json.loads((self.artifacts/'summary.json').read_text())['outcome'],'artifact_error')

    def test_runtime_is_bounded_without_unknown(self):
        result=self.invoke('running')
        self.assertEqual(result.returncode,124,result.stderr+result.stdout)
        self.assertIn('EXIT 124',result.stdout)
        self.assertNotIn('UNKNOWN',result.stdout)

    def test_job_notfound_ends_wait_immediately_with_exit_line(self):
        result = self.invoke('notfound')
        self.assertEqual(result.returncode, 70, result.stderr+result.stdout)
        summary = json.loads((self.artifacts/'summary.json').read_text())
        self.assertEqual(summary['outcome'], 'job_lost')
        self.assertIn('EXIT 70', result.stdout)
        calls = (self.root/'calls').read_text().splitlines()
        self.assertLess(sum('job' in c and 'get' in c for c in calls), 10, 'wait loop must not repeat NotFound')

    def test_sigterm_cancels_only_own_job_and_exits_143(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='runner-contract-', dir=os.environ.get('RUNNER_TEST_TMPDIR'))
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        mock = root / 'kubectl'
        mock.write_text(MOCK)
        mock.chmod(0o755)
        artifacts = root / 'output'
        env = dict(os.environ, PATH=str(root)+os.pathsep+os.environ['PATH'], MOCK_ROOT=str(root), MOCK_MODE='running')
        proc = subprocess.Popen([str(HERE/'run-tests.sh'), '-a', str(artifacts), '-q', '5', '-t', '600', '-p', '0.05',
                                 'printf', '%s', 'x'], env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        deadline = time.monotonic() + 20
        while not (root/'polls').exists() and time.monotonic() < deadline:
            time.sleep(0.05)
        proc.send_signal(signal.SIGTERM)
        out, err = proc.communicate(timeout=60)
        self.assertEqual(proc.returncode, 143, err+out)
        self.assertIn('EXIT 143', out)
        self.assertTrue((root/'deleted').exists(), 'own Job must be deleted')
        summary = json.loads((artifacts/'summary.json').read_text())
        self.assertEqual(summary['outcome'], 'interrupted')
        self.assertEqual(summary['signal'], 'SIGTERM')
        self.assertTrue(summary.get('job_cancelled'))

    def test_requested_worktree_does_not_select_old_runner_template(self):
        result=self.invoke('oldsource', extra=('-c','/var/lib/fmerp-e2e-cache'))
        self.assertEqual(result.returncode,0,result.stderr+result.stdout)
        manifest=(self.root/'manifest').read_text()
        self.assertIn('memory: 6Gi',manifest)
        self.assertNotIn('memory: 10Gi',manifest)
        self.assertIn('/var/lib/fmerp-e2e-cache/test',manifest)
        self.assertIn("printf %s 'a b; literal'",manifest)
        self.assertNotIn('${RUNNER_SCRIPT}',manifest)


class SourceSnapshotContract(unittest.TestCase):
    """Job은 라이브 worktree가 아니라 고정 스냅샷을 /src로 받는다(file changed as we read it 재발 방지)."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='snapshot-contract-', dir=os.environ.get('RUNNER_TEST_TMPDIR'))
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source = self.root / 'source'
        (self.source / 'apps/web').mkdir(parents=True)
        (self.source / 'pnpm-lock.yaml').write_text('lockfileVersion: 9.0\n')
        (self.source / 'apps/web/page.txt').write_text('page')
        for name in ['.env', '.npmrc', 'node_modules/foreign/x.js', 'apps/web/.next/cache', '.worktrees/old/.env', 'key.pem']:
            target = self.source / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text('DO_NOT_COPY')
        sys.path.insert(0, str(HERE))
        self.addCleanup(sys.path.remove, str(HERE))
        import run_tests
        self.run_tests = run_tests

    def test_snapshot_excludes_secrets_and_dependencies(self):
        dest = self.root / 'snap'
        self.run_tests.snapshot_source(self.source, dest)
        self.assertTrue((dest / 'apps/web/page.txt').exists())
        self.assertTrue((dest / 'pnpm-lock.yaml').exists())
        for name in ['.env', '.npmrc', 'node_modules', 'apps/web/.next', '.worktrees', 'key.pem']:
            self.assertFalse((dest / name).exists(), name)

    def test_change_during_copy_is_source_changed_not_a_snapshot(self):
        real_copytree = self.run_tests.shutil.copytree

        target = self.root / 'snap'

        def copy_then_mutate(src, dst, *args, **kwargs):
            real_copytree(src, dst, *args, **kwargs)
            if Path(dst) == target:  # 재귀 호출이 아니라 최상위 복사가 끝난 뒤에만 변경한다
                (Path(src) / 'apps/web/page.txt').write_text('changed while copying, longer')

        self.run_tests.shutil.copytree = copy_then_mutate
        try:
            with self.assertRaises(self.run_tests.SourceChanged):
                self.run_tests.snapshot_source(self.source, target)
        finally:
            self.run_tests.shutil.copytree = real_copytree

    def test_fingerprint_ignores_excluded_secret_changes(self):
        before = self.run_tests.tree_fingerprint(self.source)
        (self.source / '.env').write_text('changed secret, excluded from snapshot')
        self.assertEqual(before, self.run_tests.tree_fingerprint(self.source))


class MainSourceChangedContract(unittest.TestCase):
    """main() 경로: 복사 중 변경이면 Job을 만들지 않고 source_changed·EXIT 70으로 끝난다."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='main-snapshot-contract-', dir=os.environ.get('RUNNER_TEST_TMPDIR'))
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source = self.root / 'source'
        (self.source / 'apps/web').mkdir(parents=True)
        (self.source / 'pnpm-lock.yaml').write_text('lockfileVersion: 9.0\n')
        (self.source / 'apps/web/page.txt').write_text('page')
        self.output = self.root / 'output'
        sys.path.insert(0, str(HERE))
        self.addCleanup(sys.path.remove, str(HERE))
        import run_tests
        self.run_tests = run_tests
        # main()이 설치하는 SIGINT/SIGTERM/SIGHUP 핸들러가 다른 테스트로 새지 않도록 복구한다.
        saved = {sig: signal.getsignal(sig) for sig in run_tests.SIGNALS}
        self.addCleanup(lambda: [signal.signal(sig, handler) for sig, handler in saved.items()])

    def run_main(self, fake_kubectl_stdout=b''):
        calls = []
        real_run = subprocess.run

        def fake_run(argv, *args, **kwargs):
            if argv and argv[0] == 'git':
                return real_run(argv, *args, **kwargs)
            calls.append(list(argv))
            if 'create' in argv:
                return subprocess.CompletedProcess(argv, 1, fake_kubectl_stdout, b'boom')
            return subprocess.CompletedProcess(argv, 1, b'', b'')

        argv = ['run_tests.py', '-w', str(self.source), '-a', str(self.output), 'printf', 'x']
        out = io.StringIO()
        with mock.patch.object(sys, 'argv', argv), mock.patch.object(self.run_tests.subprocess, 'run', fake_run), \
                contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            code = self.run_tests.main()
        return code, calls, out.getvalue()

    def test_source_changed_during_copy_creates_no_job_and_exits_70(self):
        real_copytree = self.run_tests.shutil.copytree
        # main()은 -a 경로를 resolve()하므로(macOS /var → /private/var) 비교 대상도 resolve한다.
        target = self.output.resolve() / 'source-snapshot'

        def copy_then_mutate(src, dst, *args, **kwargs):
            real_copytree(src, dst, *args, **kwargs)
            if Path(dst) == target:
                (Path(src) / 'apps/web/page.txt').write_text('changed while copying, longer')

        with mock.patch.object(self.run_tests.shutil, 'copytree', copy_then_mutate):
            code, calls, out = self.run_main()

        self.assertEqual(code, 70, out)
        self.assertFalse([c for c in calls if 'create' in c], calls)
        self.assertEqual(calls, [], 'source_changed는 kubectl을 한 번도 호출하지 않아야 한다')
        summary = json.loads((self.output / 'summary.json').read_text())
        self.assertEqual(summary['outcome'], 'source_changed')
        self.assertIn('EXIT 70', out)

    def test_unchanged_source_reaches_job_creation(self):
        # 대조군: 변경이 없으면 같은 경로가 Job 생성 단계까지 간다(위 테스트의 통과가 우연이 아님을 보인다).
        code, calls, out = self.run_main()
        self.assertTrue([c for c in calls if 'create' in c], calls)
        summary = json.loads((self.output / 'summary.json').read_text())
        self.assertEqual(summary['outcome'], 'infrastructure_error')
        self.assertEqual(code, 70, out)


if __name__ == '__main__':
    unittest.main(verbosity=2)
