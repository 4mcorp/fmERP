"""공개 Compose CLI 계약. Docker 대역만 실행하며 실제 컨테이너/DB는 시작하지 않는다."""
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("run.py")
FAKE_DOCKER = '''#!/usr/bin/env python3
import io, json, os, pathlib, subprocess, sys, tarfile
args=sys.argv[1:]
with open(os.environ['FAKE_EVENTS'], 'a') as f:
    f.write(json.dumps({'args':args,'mode':os.environ.get('E2E_SERVER_MODE'),
                       'command':os.environ.get('E2E_TEST_CMD')})+'\\n')
if args[0]=='inspect':
    print(json.dumps({'Status':'exited','ExitCode':int(os.environ['FAKE_EXIT'])}))
elif 'ps' in args:
    print('isolated-runner')
elif 'run' in args and 'source-loader' in args:
    if os.environ.get('FAKE_SOURCE_FAIL'):
        sys.exit(1)
    if '--entrypoint' in args:
        root=pathlib.Path(os.environ['FAKE_PROJECT_ROOT'])
        assert (root/'deploy/k8s/test/run-in-container.sh').is_file()
        assert (root/'docker/postgres/initdb/01-roles.sh').is_file()
        sys.exit(0)
    payload=sys.stdin.buffer.read()
    with tarfile.open(fileobj=io.BytesIO(payload), mode='r:*') as archive:
        names=archive.getnames()
        assert 'tracked.txt' in names and '.env' not in names
        assert not any(name.startswith('node_modules/') for name in names)
        assert archive.extractfile('tracked.txt').read() == b'snapshot-content'
    pathlib.Path(os.environ['FAKE_EVENTS']+'.tar').write_bytes(payload)
elif 'cp' in args:
    if os.environ.get('FAKE_COPY_FAIL'): sys.exit(1)
    pathlib.Path(args[-1], 'runner-summary.json').write_text('{}')
elif 'wait' in args and os.environ.get('FAKE_SIGNAL'):
    import signal
    os.kill(os.getppid(), signal.SIGTERM)
elif 'wait' in args and os.environ.get('FAKE_TIMEOUT'):
    import time
    time.sleep(3)
elif 'up' in args and os.environ.get('FAKE_UP_FAIL'): sys.exit(1)
elif 'down' in args and os.environ.get('FAKE_CLEANUP_FAIL'): sys.exit(1)
'''


class ComposeCliContract(unittest.TestCase):
    def invoke(self, test_exit=0, cleanup_failure=False, copy_failure=False,
               extra_env=None, setup_case=None):
        with tempfile.TemporaryDirectory(dir=os.environ.get("RUNNER_TEST_TMPDIR")) as temp:
            tmp = Path(temp)
            root = tmp / "project"
            (root / "deploy" / "e2e").mkdir(parents=True)
            (root / "deploy" / "k8s" / "test").mkdir(parents=True)
            (root / "docker" / "postgres" / "initdb").mkdir(parents=True)
            subprocess.run(["git", "init", "--quiet", str(root)], check=True)
            (root / "deploy" / "e2e" / "run.py").write_bytes(SCRIPT.read_bytes())
            (root / "docker-compose.e2e.yml").write_text("services: {}\n")
            (root / "deploy" / "k8s" / "test" / "run-in-container.sh").write_text("snapshot-script")
            (root / "docker" / "postgres" / "initdb" / "01-roles.sh").write_text("snapshot-sql")
            (root / "tracked.txt").write_text("snapshot-content")
            (root / ".env").write_text("secret-value")
            (root / "node_modules").mkdir()
            (root / "node_modules" / "secret").write_text("excluded")
            (root / "excluded.pem").write_text("private-key")
            (root / "white space.txt").write_text("space-path")
            outside = tmp / "outside"
            outside.mkdir()
            (outside / "escape-target").write_text("outside-target")
            (root / "escape-target").write_text("inside-target")
            os.symlink("escape-target", root / "escape-link")
            subprocess.run(["git", "-C", str(root), "add", "deploy", "docker", "docker-compose.e2e.yml", "tracked.txt", "white space.txt", "escape-link"], check=True)
            if setup_case:
                setup_case(root, outside)
                subprocess.run(["git", "-C", str(root), "add", "-A", "."], check=True)
            docker = tmp / "docker-bin"
            docker.mkdir()
            docker_cli = docker / "docker"
            docker_cli.write_text(FAKE_DOCKER)
            docker_cli.chmod(0o700)
            events = tmp / "events.jsonl"
            artifacts = tmp / "output"
            env = {**os.environ, "PATH": f"{docker}:{os.environ['PATH']}",
                   "FAKE_EVENTS": str(events), "FAKE_EXIT": str(test_exit),
                   "FAKE_PROJECT_ROOT": str(root), "FAKE_OUTPUT": str(tmp / "nested-output"),
                   "FAKE_NESTED_RESULT": str(tmp / "nested-result.json"),
                   "TMPDIR": os.environ.get("RUNNER_TEST_TMPDIR", tempfile.gettempdir())}
            if cleanup_failure:
                env["FAKE_CLEANUP_FAIL"] = "1"
            if copy_failure:
                env["FAKE_COPY_FAIL"] = "1"
            env.update(extra_env or {})
            result = subprocess.run(
                [sys.executable, str(root / "deploy/e2e/run.py"), "--timeout", "1", "--mode", "production", "--artifacts",
                 str(artifacts), "--", "pnpm", "test:e2e", "--grep", "공백 ; literal"],
                env=env, capture_output=True, text=True,
            )
            self.assertTrue((artifacts / "compose.log").exists(), result.stderr)
            summary = json.loads((artifacts / "compose-summary.json").read_text())
            events_data = [json.loads(line) for line in events.read_text().splitlines()]
            tar_path = Path(str(events) + ".tar")
            tar_bytes = tar_path.read_bytes() if tar_path.exists() else None
            manifest_path = artifacts / "source-manifest.json"
            manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else None
            nested_path = tmp / "nested-result.json"
            nested = json.loads(nested_path.read_text()) if nested_path.exists() else None
            return result, summary, events_data, tar_bytes, manifest, nested

    def test_success_collects_before_project_scoped_cleanup(self):
        result, summary, events, captured_tar, manifest, _ = self.invoke()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(summary["test_exit_code"], 0)
        self.assertEqual(summary["errors"], [])
        self.assertEqual(manifest["sha256"], summary["source"]["sha256"])
        self.assertGreater(manifest["file_count"], 0)
        with tarfile.open(fileobj=io.BytesIO(captured_tar), mode="r:*") as archive:
            names = archive.getnames()
            self.assertIn("tracked.txt", names)
            self.assertIn("white space.txt", names)
            self.assertIn("docker/postgres/initdb/01-roles.sh", names)
            self.assertNotIn(".env", names)
            self.assertNotIn("excluded.pem", names)
            self.assertFalse(any(name.startswith("node_modules/") for name in names))
            self.assertEqual(archive.extractfile("tracked.txt").read(), b"snapshot-content")
        calls = [event["args"] for event in events]
        self.assertEqual(calls[0][0], "compose")
        self.assertEqual(calls[0][-1], "prepare-runner")
        loader = next(call for call in calls if call[-1:] == ["source-loader"])
        self.assertIn("-T", loader)
        self.assertIn("--no-deps", loader)
        compose_calls = [call for call in calls if call[0] == "compose"]
        projects = {call[call.index("--project-name") + 1] for call in compose_calls}
        self.assertEqual(projects, {summary["project"]})
        self.assertRegex(summary["project"], r"^fmerp-e2e-[a-f0-9]{32}$")
        self.assertLess(next(i for i, call in enumerate(calls) if "cp" in call),
                        next(i for i, call in enumerate(calls) if "down" in call))
        self.assertIn("--volumes", compose_calls[-1])
        self.assertNotIn("--remove-orphans", compose_calls[-1])
        self.assertTrue(all(event["mode"] == "production" for event in events))
        self.assertTrue(all(event["command"] == "pnpm test:e2e --grep '공백 ; literal'" for event in events))

    def test_test_failure_wins_over_cleanup_error_but_error_is_recorded(self):
        result, summary, _, _, _, _ = self.invoke(test_exit=7, cleanup_failure=True)
        self.assertEqual(result.returncode, 7)
        self.assertEqual(summary["test_exit_code"], 7)
        self.assertEqual(summary["errors"][0]["phase"], "cleanup")

    def test_success_does_not_hide_artifact_or_cleanup_failure(self):
        for kwargs in [{"copy_failure": True}, {"cleanup_failure": True}]:
            with self.subTest(kwargs=kwargs):
                result, summary, _, _, _, _ = self.invoke(**kwargs)
                self.assertEqual(result.returncode, 74)
                self.assertEqual(summary["test_exit_code"], 0)
                self.assertTrue(summary["errors"])

    def test_timeout_signal_and_partial_start_still_collect_and_cleanup(self):
        for flag, expected, phase in [("FAKE_TIMEOUT", 124, "timeout"),
                                       ("FAKE_SIGNAL", 143, "signal"),
                                       ("FAKE_UP_FAIL", 70, "execution")]:
            with self.subTest(flag=flag):
                result, summary, events, _, _, _ = self.invoke(extra_env={flag: "1"})
                self.assertEqual(result.returncode, expected, result.stderr)
                self.assertIsNone(summary["test_exit_code"])
                self.assertEqual(summary["errors"][0]["phase"], phase)
                self.assertTrue(any("cp" in event["args"] for event in events))
                self.assertTrue(any("down" in event["args"] for event in events))

    def test_project_is_unique_for_each_invocation(self):
        _, first, _, _, _, _ = self.invoke()
        _, second, _, _, _, _ = self.invoke()
        self.assertNotEqual(first["project"], second["project"])

    def test_source_failure_prevents_database_start_and_preserves_summary(self):
        result, summary, events, _, _, _ = self.invoke(extra_env={"FAKE_SOURCE_FAIL": "1"})
        self.assertEqual(result.returncode, 70, result.stderr)
        self.assertIsNone(summary["test_exit_code"])
        self.assertFalse(any("up" in event["args"] for event in events))
        self.assertTrue(any("down" in event["args"] for event in events))

    def test_excluded_or_external_symlink_aliases_fail_before_database_start(self):
        cases = {
            "excluded": lambda root, outside: (root / "alias-env").symlink_to(".env"),
            "external": lambda root, outside: (root / "alias-out").symlink_to(outside / "escape-target"),
        }
        for name, setup in cases.items():
            with self.subTest(case=name):
                result, summary, events, tar_bytes, _, _ = self.invoke(setup_case=setup)
                self.assertEqual(result.returncode, 70, result.stderr)
                self.assertIsNone(summary["test_exit_code"])
                self.assertFalse(any("up" in event["args"] for event in events))

    def test_tracked_file_deleted_from_worktree_is_not_transferred(self):
        def setup(root, outside):
            (root / "gone.txt").write_text("gone")
            subprocess.run(["git", "-C", str(root), "add", "gone.txt"], check=True)
            (root / "gone.txt").unlink()
        result, summary, _, tar_bytes, _, _ = self.invoke(setup_case=setup)
        self.assertEqual(result.returncode, 0, result.stderr)
        with tarfile.open(fileobj=io.BytesIO(tar_bytes), mode="r:*") as archive:
            self.assertNotIn("gone.txt", archive.getnames())

    def test_unknown_mode_is_rejected_before_docker(self):
        result = subprocess.run([sys.executable, str(SCRIPT), "--mode", "prodution"],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn("invalid choice", result.stderr)


if __name__ == "__main__":
    unittest.main()
