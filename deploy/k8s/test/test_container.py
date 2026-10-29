#!/usr/bin/env python3
"""공통 컨테이너 shell 공개 인터페이스: 외부 도구 mock, Node/tar는 실제 실행."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

HERE = Path(__file__).resolve().parent


class ContainerContract(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='container-contract-', dir=os.environ.get('RUNNER_TEST_TMPDIR'))
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.src = self.root/'src'
        self.src.mkdir()
        (self.src/'package.json').write_text('{"packageManager":"pnpm@11.28.3"}')
        (self.src/'pnpm-lock.yaml').write_text('lockfileVersion: 9.0\n')
        (self.src/'pnpm-workspace.yaml').write_text('packages: []\n')
        for name in ['.env', '.env.test', '.npmrc', 'node_modules/foreign', 'nested/node_modules/foreign', '.next/cache', '.worktrees/old/.env', 'nested/.env']:
            target=self.src/name
            target.parent.mkdir(parents=True,exist_ok=True)
            target.write_text('DO_NOT_COPY')
        self.bin = self.root/'bin'
        self.bin.mkdir()
        node=shutil.which('node')
        if node is None:
            self.skipTest('Node 실행 파일 필요 (이미지 설치/다운로드 없음)')
        scripts = {
            'corepack': '#!/bin/bash\nexit 0\n',
            'psql': '#!/bin/bash\nexit "${FAKE_SQL_EXIT:-0}"\n',
            'node': '#!/bin/bash\nif [[ "${2:-}" == fetch* ]]; then exit 0; fi\nexec '+node+' "$@"\n',
            'pnpm': '''#!/bin/bash
if [ "$1" = pkg ]; then exit 0; fi
if [ "$1" = install ]; then
  [ "${FAKE_INSTALL_EXIT:-0}" = 0 ] || exit "$FAKE_INSTALL_EXIT"
  [ ! -f "$PNPM_STORE_DIR/payload" ] || echo warm-store
  echo installed > "$PNPM_STORE_DIR/payload"
  exit 0
fi
exit 99
'''}
        for name, script in scripts.items():
            target=self.bin/name
            target.write_text(script)
            target.chmod(0o755)

    def run_container(self, name='one', command='mkdir -p apps/web/test-results; printf trace > apps/web/test-results/trace.zip', **overrides):
        art=self.root/name/'artifacts'
        env=dict(os.environ, PATH=str(self.bin)+os.pathsep+os.environ['PATH'], RUNNER_SOURCE=str(self.src),
                 RUNNER_WORK=str(self.root/name/'work'), RUNNER_ARTIFACTS=str(art),
                 RUNNER_CACHE=str(self.root/'cache'), PNPM_STORE_DIR=str(self.root/name/'store'),
                 COLLECT_WAIT_SECONDS='0', SERVICE_TIMEOUT_SECONDS='0', TEST_CMD=command)
        env.update(overrides)
        result=subprocess.run(['bash',str(HERE/'run-in-container.sh')],env=env,capture_output=True,text=True,timeout=15)
        return result,art

    def test_reusable_cache_does_not_share_node_modules_or_copy_secrets(self):
        first,art=self.run_container()
        self.assertEqual(first.returncode,0,first.stdout+first.stderr)
        second,second_art=self.run_container('two')
        self.assertEqual(second.returncode,0,second.stdout+second.stderr)
        self.assertTrue((second_art/'cache.txt').read_text().startswith('hit '))
        self.assertIn('warm-store',(second_art/'install.log').read_text())
        for name in ['.env','.env.test','.npmrc','node_modules/foreign','nested/node_modules/foreign','.next/cache','.worktrees/old/.env','nested/.env']:
            self.assertFalse((self.root/'two/work'/name).exists(),name)
        self.assertEqual((art/'apps/web/test-results/trace.zip').read_text(),'trace')
        summary=json.loads((art/'runner-summary.json').read_text())
        self.assertEqual(set(summary['phases']),{'prep','install','services','test'})
        self.assertEqual(summary['exit_code'],0)
        metrics=[json.loads(line) for line in (art/'metrics.jsonl').read_text().splitlines()]
        self.assertTrue(metrics)
        self.assertEqual(set(metrics[0]),{'timestamp','cgroup','processes'})

    def test_cache_copy_failure_is_fatal(self):
        cp=self.bin/'cp'
        cp.write_text('#!/bin/bash\nexit 31\n')
        cp.chmod(0o755)
        result,art=self.run_container()
        self.assertEqual(result.returncode,31,result.stdout+result.stderr)
        self.assertEqual(json.loads((art/'runner-summary.json').read_text())['last_phase'],'install')

    def test_cache_publication_is_safe_under_concurrent_jobs(self):
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures=[executor.submit(self.run_container,name) for name in ['one','two']]
            for future in futures:
                result,_=future.result()
                self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        third,art=self.run_container('three')
        self.assertEqual(third.returncode,0,third.stdout+third.stderr)
        self.assertTrue((art/'cache.txt').read_text().startswith('hit '))
        self.assertIn('warm-store',(art/'install.log').read_text())

    def test_install_failure_propagates_and_preserves_install_log(self):
        result,art=self.run_container(FAKE_INSTALL_EXIT='23')
        self.assertEqual(result.returncode,23,result.stdout+result.stderr)
        summary=json.loads((art/'runner-summary.json').read_text())
        self.assertEqual(summary['last_phase'],'install')
        self.assertEqual((art/'exit-code').read_text().strip(),'23')
        self.assertTrue((art/'install.log').exists())

    def test_readiness_failure_does_not_run_tests(self):
        result,art=self.run_container(FAKE_SQL_EXIT='1')
        self.assertEqual(result.returncode,69,result.stdout+result.stderr)
        self.assertEqual(json.loads((art/'runner-summary.json').read_text())['last_phase'],'services')
        self.assertFalse((art/'apps/web/test-results').exists())

    def test_source_copy_failure_is_fatal(self):
        result,art=self.run_container(RUNNER_SOURCE=str(self.root/'missing'))
        self.assertNotEqual(result.returncode,0)
        self.assertEqual(json.loads((art/'runner-summary.json').read_text())['last_phase'],'prep')

    def test_test_failure_keeps_original_exit_and_artifacts(self):
        result,art=self.run_container(command='mkdir -p test-results; echo evidence > test-results/failure.txt; exit 7')
        self.assertEqual(result.returncode,7,result.stdout+result.stderr)
        self.assertEqual((art/'test-results/failure.txt').read_text(),'evidence\n')
        self.assertEqual(json.loads((art/'runner-summary.json').read_text())['exit_code'],7)

    def test_lockfile_change_misses_cache(self):
        first,_=self.run_container()
        self.assertEqual(first.returncode,0,first.stdout+first.stderr)
        (self.src/'pnpm-lock.yaml').write_text('lockfileVersion: 9.0\n# changed\n')
        result,art=self.run_container('two')
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertTrue((art/'cache.txt').read_text().startswith('miss '))


if __name__ == '__main__':
    unittest.main(verbosity=2)
