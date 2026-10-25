#!/usr/bin/env python3
"""공개 shell 인터페이스 계약. 실제 kubectl/클러스터는 호출하지 않는다."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

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
        self.assertIn('exceeded quota', (self.artifacts/'events.json').read_text())

    def test_artifact_copy_failure_is_not_reported_as_pass(self):
        result=self.invoke('copyfail')
        self.assertEqual(result.returncode,74,result.stderr+result.stdout)
        self.assertEqual(json.loads((self.artifacts/'summary.json').read_text())['outcome'],'artifact_error')

    def test_runtime_is_bounded_without_unknown(self):
        result=self.invoke('running')
        self.assertEqual(result.returncode,124,result.stderr+result.stdout)
        self.assertNotIn('UNKNOWN',result.stdout)

    def test_requested_worktree_does_not_select_old_runner_template(self):
        result=self.invoke('oldsource', extra=('-c','/var/lib/fmerp-e2e-cache'))
        self.assertEqual(result.returncode,0,result.stderr+result.stdout)
        manifest=(self.root/'manifest').read_text()
        self.assertIn('memory: 6Gi',manifest)
        self.assertNotIn('memory: 10Gi',manifest)
        self.assertIn('/var/lib/fmerp-e2e-cache/test',manifest)
        self.assertIn("printf %s 'a b; literal'",manifest)
        self.assertNotIn('${RUNNER_SCRIPT}',manifest)


if __name__ == '__main__':
    unittest.main(verbosity=2)
