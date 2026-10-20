"""discord_pr_event 실패 로그 형식과 비밀값 미노출, discord-pr-events 워크플로 격리 검사."""
import contextlib
import importlib.util
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from urllib.error import HTTPError, URLError

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / '.github/scripts/discord_pr_event.py'
WORKFLOW = ROOT / '.github/workflows/discord-pr-events.yml'

_spec = importlib.util.spec_from_file_location('discord_pr_event', SCRIPT)
emitter = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(emitter)

TOKEN = 'SECRETTOKEN-abc123XYZ'
WEBHOOK = 'https://discord.com/api/webhooks/123456789012345678/' + TOKEN
PAYLOAD = {'content': emitter.SENTINEL + '{"event":"pull_request"}', 'flags': 4096,
           'allowed_mentions': {'parse': []}}


def http_error(code, body=b''):
    return HTTPError(WEBHOOK, code, 'reason ' + TOKEN, {}, io.BytesIO(body))


def no_sleep(_):
    return None


class SendEventFailureTest(unittest.TestCase):
    def test_post_rejection_reports_stage_and_status_only(self):
        def request(method, url, body):
            raise http_error(500, b'{"message":"' + TOKEN.encode() + b'"}')

        with self.assertRaises(emitter.DeliveryError) as ctx:
            emitter.send_event(WEBHOOK, PAYLOAD, request=request, sleep=no_sleep)
        line = ctx.exception.describe()
        self.assertEqual(line, 'stage=post status=500')
        self.assertNotIn(TOKEN, line)

    def test_rate_limit_retries_then_reports_retry_after(self):
        delays = []
        calls = []

        def request(method, url, body):
            calls.append(method)
            raise http_error(429, b'{"retry_after": 0.25, "message": "slow down"}')

        with self.assertRaises(emitter.DeliveryError) as ctx:
            emitter.send_event(WEBHOOK, PAYLOAD, request=request, sleep=delays.append)
        self.assertEqual(len(calls), 4)
        self.assertEqual(delays, [0.25, 0.25, 0.25])
        self.assertEqual(ctx.exception.describe(), 'stage=post status=429 retry_after=0.25')
        self.assertNotIn(TOKEN, ctx.exception.describe())

    def test_rate_limit_over_budget_is_reported_with_value(self):
        def request(method, url, body):
            raise http_error(429, b'{"retry_after": 99}')

        with self.assertRaises(emitter.DeliveryError) as ctx:
            emitter.send_event(WEBHOOK, PAYLOAD, request=request, sleep=no_sleep)
        self.assertEqual(ctx.exception.describe(), 'stage=post status=429 retry_after=99.0')

    def test_network_error_reports_exception_class_only(self):
        def request(method, url, body):
            raise URLError('connect to ' + WEBHOOK)

        with self.assertRaises(emitter.DeliveryError) as ctx:
            emitter.send_event(WEBHOOK, PAYLOAD, request=request, sleep=no_sleep)
        line = ctx.exception.describe()
        self.assertEqual(line, 'stage=post exc=URLError')
        self.assertNotIn(TOKEN, line)

    def test_readback_stage_is_named_when_message_mismatches(self):
        def request(method, url, body):
            if method == 'POST':
                return {'id': '987654321'}
            return {'id': '987654321', 'content': 'different', 'flags': 4096}

        with self.assertRaises(emitter.DeliveryError) as ctx:
            emitter.send_event(WEBHOOK, PAYLOAD, request=request, sleep=no_sleep)
        self.assertEqual(ctx.exception.describe(), 'stage=readback')

    def test_readback_http_error_is_named_readback(self):
        def request(method, url, body):
            if method == 'POST':
                return {'id': '987654321'}
            raise http_error(404)

        with self.assertRaises(emitter.DeliveryError) as ctx:
            emitter.send_event(WEBHOOK, PAYLOAD, request=request, sleep=no_sleep)
        self.assertEqual(ctx.exception.describe(), 'stage=readback status=404')

    def test_success_returns_verified_message_id(self):
        def request(method, url, body):
            if method == 'POST':
                return {'id': '987654321'}
            return {'id': '987654321', 'content': PAYLOAD['content'], 'flags': 4096}

        self.assertEqual(emitter.send_event(WEBHOOK, PAYLOAD, request=request, sleep=no_sleep), '987654321')


class MainOutputTest(unittest.TestCase):
    def run_main(self, send_side_effect):
        event = {
            'action': 'opened', 'repository': {'full_name': '4mcorp/fmERP'},
            'pull_request': {'id': 1, 'number': 7, 'updated_at': '2026-10-20T00:00:00Z',
                             'head': {'sha': 'a' * 40}},
        }
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'event.json'
            path.write_text(json.dumps(event), encoding='utf-8')
            env = {'GITHUB_EVENT_PATH': str(path), 'GITHUB_EVENT_NAME': 'pull_request_target',
                   'GITHUB_REPOSITORY': '4mcorp/fmERP', 'HERMES_DISCORD_EVENTS_WEBHOOK': WEBHOOK}
            old = {k: os.environ.get(k) for k in env}
            os.environ.update(env)
            out = io.StringIO()
            try:
                original = emitter.send_event
                emitter.send_event = send_side_effect
                try:
                    with contextlib.redirect_stdout(out):
                        code = emitter.main([])
                finally:
                    emitter.send_event = original
            finally:
                for key, value in old.items():
                    if value is None:
                        os.environ.pop(key, None)
                    else:
                        os.environ[key] = value
        return code, out.getvalue()

    def test_failure_log_has_no_webhook_token_or_payload(self):
        def boom(webhook, payload):
            raise RuntimeError('leaked ' + webhook + ' ' + payload['content'])

        code, output = self.run_main(boom)
        self.assertEqual(code, 1)
        self.assertEqual(output.strip(), 'notifier failed: stage=validate exc=RuntimeError; no verified receipt')
        self.assertNotIn(TOKEN, output)
        self.assertNotIn('discord.com', output)
        self.assertNotIn('HERMES_GITHUB_EVENT_V1', output)

    def test_delivery_failure_line_names_stage_and_status(self):
        def rejected(webhook, payload):
            raise emitter.DeliveryError('post', status=403)

        code, output = self.run_main(rejected)
        self.assertEqual(code, 1)
        self.assertEqual(output.strip(), 'notifier failed: stage=post status=403; no verified receipt')
        self.assertNotIn(TOKEN, output)


class WorkflowIsolationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = WORKFLOW.read_text(encoding='utf-8')
        # Top-level text is split per step so each step's own keys can be checked.
        cls.steps = {}
        for block in cls.text.split('\n      - name: ')[1:]:
            name = block.split('\n', 1)[0].strip()
            cls.steps[name] = block

    def test_emit_runs_are_serialized_and_never_cancelled(self):
        self.assertIn('\nconcurrency:\n  group: discord-pr-events\n  cancel-in-progress: false\n  queue: max\n', self.text)
        self.assertNotIn('cancel-in-progress: true', self.text)

    def test_notifier_failure_does_not_fail_the_job(self):
        self.assertNotIn('\n    continue-on-error', self.text)
        send = self.steps['Send metadata event and verify Discord receipt']
        self.assertIn('continue-on-error: true', send)
        self.assertIn('HERMES_DISCORD_EVENTS_WEBHOOK: ${{ secrets.HERMES_DISCORD_EVENTS_WEBHOOK }}', send)

    def test_secret_is_passed_only_to_the_send_step(self):
        for name, block in self.steps.items():
            if name == 'Send metadata event and verify Discord receipt':
                continue
            self.assertNotIn('secrets.HERMES_DISCORD_EVENTS_WEBHOOK', block, name)

    def test_summary_step_does_not_echo_secrets_or_failure_text(self):
        summary = self.steps['Summarize notifier outcome (non-blocking)']
        self.assertNotIn('secrets.', summary)
        self.assertNotIn('HERMES_DISCORD_EVENTS_WEBHOOK', summary)


if __name__ == '__main__':
    unittest.main()
