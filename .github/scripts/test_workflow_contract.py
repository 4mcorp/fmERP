"""실행 명령·잡 의존성의 회귀 검사. YAML 문법은 별도로 actionlint가 검증한다."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]


class WorkflowContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ci = (ROOT / '.github/workflows/ci.yml').read_text(encoding='utf-8')
        cls.e2e = (ROOT / '.github/workflows/e2e.yml').read_text(encoding='utf-8')

    def test_integration_is_not_filtered_by_feature_path(self):
        self.assertIn('test-integration -- pnpm exec vitest run --project integration\n', self.ci)

    def test_feature_jobs_run_only_unit_tests(self):
        self.assertIn('-- pnpm exec vitest run --project unit features/${{ matrix.feature }}/', self.ci)

    def test_main_e2e_is_required_by_check(self):
        self.assertIn('needs: [scope, static, test-feature, test-core, test-integration, e2e]', self.ci)
        self.assertIn("if: github.event_name == 'pull_request' && github.base_ref == 'main'\n    uses: ./.github/workflows/e2e.yml", self.ci)
        self.assertIn("e2e: ${{ github.event_name == 'pull_request' && github.base_ref == 'main' }}", self.ci)

    def test_e2e_is_callable_without_duplicate_pr_runs(self):
        self.assertIn('  workflow_call:', self.e2e)
        self.assertNotIn('  pull_request:', self.e2e)


if __name__ == '__main__':
    unittest.main()
