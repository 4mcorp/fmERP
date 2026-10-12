"""집계 잡은 필요한 잡/게이트가 빠지면 실패해야 한다."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("ci-result.py").resolve()


class CIResultTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="ci-result-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.needs = {
            "scope": {"result": "success", "outputs": {"features": '["org"]', "core": "true", "e2e": "false"}},
            "static": {"result": "success"},
            "test-feature": {"result": "success"},
            "test-core": {"result": "success"},
            "test-integration": {"result": "success"},
            "e2e": {"result": "skipped"},
        }
        for job, names in {"static": ["biome", "typecheck", "arch-check", "arch-guard"],
                           "org": ["test-org"], "core": ["test-core"],
                           "integration": ["test-integration"]}.items():
            directory = self.root / "downloaded" / f"quality-report-{job}"
            directory.mkdir(parents=True)
            report = {"schemaVersion": 1, "commit": "test", "metrics": {"ratchets": {}},
                      "gates": [{"name": name, "pass": True, "exitCode": 0} for name in names]}
            (directory / "quality-report.json").write_text(json.dumps(report))

    def run_check(self):
        result = subprocess.run([sys.executable, "-X", "utf8", "-I", str(SCRIPT)], cwd=self.root,
                                env=dict(os.environ, NEEDS_JSON=json.dumps(self.needs)),
                                capture_output=True, text=True, encoding="utf-8", errors="replace")
        return result

    def test_collects_all_gates(self):
        result = self.run_check()
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        report = json.loads((self.root / "artifacts/quality-report.json").read_text())
        self.assertTrue(report["pass"])
        self.assertEqual(len(report["gates"]), 7)

    def test_required_integration_skip_fails(self):
        self.needs["test-integration"] = {"result": "skipped"}
        self.assertNotEqual(self.run_check().returncode, 0)

    def test_main_e2e_skip_fails(self):
        self.needs["scope"]["outputs"]["e2e"] = "true"
        self.needs["e2e"] = {"result": "skipped"}
        self.assertNotEqual(self.run_check().returncode, 0)

    def test_main_e2e_success_passes(self):
        self.needs["scope"]["outputs"]["e2e"] = "true"
        self.needs["e2e"] = {"result": "success"}
        directory = self.root / "downloaded/quality-report-e2e"
        directory.mkdir()
        (directory / "quality-report.json").write_text(json.dumps({
            "gates": [{"name": "e2e", "pass": True, "exitCode": 0}]}))
        self.assertEqual(self.run_check().returncode, 0)

    def test_main_e2e_artifact_missing_fails(self):
        self.needs["scope"]["outputs"]["e2e"] = "true"
        self.needs["e2e"] = {"result": "success"}
        self.assertNotEqual(self.run_check().returncode, 0)

    def test_missing_feature_scope_fails(self):
        del self.needs["scope"]["outputs"]["features"]
        self.needs["test-feature"]["result"] = "skipped"
        (self.root / "downloaded/quality-report-org/quality-report.json").unlink()
        self.assertNotEqual(self.run_check().returncode, 0)

    def test_required_job_skip_fails(self):
        self.needs["test-core"]["result"] = "skipped"
        self.assertNotEqual(self.run_check().returncode, 0)

    def test_scope_skip_fails(self):
        self.needs["scope"]["result"] = "skipped"
        self.assertNotEqual(self.run_check().returncode, 0)

    def test_missing_artifact_fails(self):
        (self.root / "downloaded/quality-report-org/quality-report.json").unlink()
        self.assertNotEqual(self.run_check().returncode, 0)

    def test_failed_gate_fails(self):
        report = self.root / "downloaded/quality-report-core/quality-report.json"
        report.write_text(json.dumps({"gates": [{"name": "test-core", "pass": False, "exitCode": 1}]}))
        self.assertNotEqual(self.run_check().returncode, 0)

    def test_static_only_download_layout_passes(self):
        # 범위상 기능·코어·E2E가 모두 skip인 PR: 단일 아티팩트 quality-report-static만 내려받는다.
        self.needs["scope"]["outputs"] = {"features": "[]", "core": "false", "e2e": "false"}
        self.needs["test-feature"]["result"] = "skipped"
        self.needs["test-core"]["result"] = "skipped"
        self.needs["test-integration"]["result"] = "skipped"
        for job in ("org", "core", "integration"):
            (self.root / f"downloaded/quality-report-{job}/quality-report.json").unlink()
            (self.root / f"downloaded/quality-report-{job}").rmdir()
        result = self.run_check()
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)

    def test_static_only_flat_download_layout_passes(self):
        # 실제 CI(run 38185377858): 단일 아티팩트는 downloaded/ 바로 아래에 풀린다(이름 폴더 없음).
        self.needs["scope"]["outputs"] = {"features": "[]", "core": "false", "e2e": "false"}
        self.needs["test-feature"]["result"] = "skipped"
        self.needs["test-core"]["result"] = "skipped"
        self.needs["test-integration"]["result"] = "skipped"
        static_dir = self.root / "downloaded/quality-report-static"
        static_report = static_dir / "quality-report.json"
        (self.root / "downloaded/quality-report.json").write_text(static_report.read_text())
        static_report.unlink()
        static_dir.rmdir()
        for job in ("org", "core", "integration"):
            (self.root / f"downloaded/quality-report-{job}/quality-report.json").unlink()
            (self.root / f"downloaded/quality-report-{job}").rmdir()
        result = self.run_check()
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)

    def test_flat_root_report_does_not_mask_missing_static_when_multiple_reports_expected(self):
        # 기대 리포트가 여럿이면 downloaded/quality-report.json으로 static을 대체하지 않는다(누락은 실패).
        static_dir = self.root / "downloaded/quality-report-static"
        static_report = static_dir / "quality-report.json"
        (self.root / "downloaded/quality-report.json").write_text(static_report.read_text())
        static_report.unlink()
        static_dir.rmdir()
        result = self.run_check()
        self.assertNotEqual(result.returncode, 0)

    def test_expected_skips_pass(self):
        self.needs["scope"]["outputs"] = {"features": "[]", "core": "false", "e2e": "false"}
        self.needs["test-feature"]["result"] = "skipped"
        self.needs["test-core"]["result"] = "skipped"
        self.needs["test-integration"]["result"] = "skipped"
        for job in ("org", "core", "integration"):
            (self.root / f"downloaded/quality-report-{job}/quality-report.json").unlink()
        self.assertEqual(self.run_check().returncode, 0)


if __name__ == "__main__":
    unittest.main()
