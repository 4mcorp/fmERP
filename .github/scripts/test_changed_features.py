"""실제 임시 Git 저장소로 변경 범위 회귀 검증 (DB/개발 저장소 수정 없음)."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("changed-features.sh").resolve()


class ChangedFeaturesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="ci-scope-")
        self.addCleanup(self.tmp.cleanup)
        self.repo = Path(self.tmp.name)
        self.git("init", "-q")
        self.git("config", "user.name", "CI scope tests")
        self.git("config", "user.email", "ci@example.invalid")
        for feature in ("approval", "audit", "org"):
            self.write(f"features/{feature}/src/sample.test.ts", "test\n")
        self.write("features/home/src/index.ts", "no tests\n")
        self.write("features/org/src/old.ts", "old\n")
        self.commit()
        self.base = self.git("rev-parse", "HEAD").strip()

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.repo, check=True,
                              capture_output=True, text=True).stdout

    def write(self, name, text="changed\n"):
        target = self.repo / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")

    def commit(self):
        self.git("add", "-A")
        self.git("commit", "-qm", "test: snapshot")

    def scope(self, paths=(), event="pull_request", base_ref="dev", base_sha=None):
        for name in paths:
            self.write(name)
        if paths:
            self.commit()
        output = self.repo / "output.txt"
        env = dict(os.environ, EVENT_NAME=event, BASE_REF=base_ref,
                   BASE_SHA=base_sha or self.base, GITHUB_OUTPUT=output.as_posix())
        subprocess.run(["bash", SCRIPT.as_posix()], cwd=self.repo, env=env,
                       check=True, capture_output=True, text=True)
        values = dict(line.split("=", 1) for line in output.read_text().splitlines())
        return values["core"] == "true", json.loads(values["features"])

    def test_single_feature(self):
        self.assertEqual(self.scope(["features/org/src/change.ts"]), (True, ["org"]))

    def test_multiple_features(self):
        self.assertEqual(self.scope(["features/org/src/change.ts", "features/audit/src/change.ts"]),
                         (True, ["audit", "org"]))

    def test_shared_falls_back_to_full(self):
        self.assertEqual(self.scope(["shared/src/change.ts"]), (True, ["approval", "audit", "org"]))

    def test_docs_skip_tests(self):
        self.assertEqual(self.scope(["docs/change.md"]), (False, []))

    def test_docs_do_not_hide_feature(self):
        self.assertEqual(self.scope(["docs/change.md", "features/org/src/change.ts"]), (True, ["org"]))

    def test_feature_without_tests_runs_core(self):
        self.assertEqual(self.scope(["features/home/src/index.ts"]), (True, []))

    def test_integration_only_feature_uses_integration_job(self):
        self.write("features/account/tests/account.int.test.ts")
        self.commit()
        self.base = self.git("rev-parse", "HEAD").strip()
        self.assertEqual(self.scope(["features/account/src/change.ts"]), (True, []))

    def test_push_runs_full(self):
        self.assertEqual(self.scope(event="push"), (True, ["approval", "audit", "org"]))

    def test_main_runs_full(self):
        self.assertEqual(self.scope(base_ref="main"), (True, ["approval", "audit", "org"]))

    def test_missing_base_runs_full(self):
        self.assertEqual(self.scope(base_sha="missing-ref"), (True, ["approval", "audit", "org"]))

    def test_rename_selects_both_features(self):
        self.git("mv", "features/org/src/old.ts", "features/audit/src/moved.ts")
        self.commit()
        self.assertEqual(self.scope(), (True, ["audit", "org"]))

    def test_deleted_feature_runs_full(self):
        self.git("rm", "-r", "features/org")
        self.commit()
        self.assertEqual(self.scope(), (True, ["approval", "audit"]))

    def test_spaces_in_filename(self):
        self.assertEqual(self.scope(["features/org/src/with spaces.ts"]), (True, ["org"]))

    @unittest.skipIf(os.name == "nt", "Windows 파일명에는 줄바꿈을 사용할 수 없음")
    def test_newline_in_filename(self):
        self.assertEqual(self.scope(["features/org/src/with\nnewline.ts"]), (True, ["org"]))

    def test_ci_script_change_runs_full(self):
        self.assertEqual(self.scope([".github/scripts/changed-features.sh"]),
                         (True, ["approval", "audit", "org"]))

    def test_no_changes_skip_tests(self):
        self.assertEqual(self.scope(), (False, []))


if __name__ == "__main__":
    unittest.main()
