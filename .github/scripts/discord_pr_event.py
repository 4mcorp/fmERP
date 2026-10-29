"""Trusted metadata-only GitHub event emitter. Python standard library only."""
import hashlib
import json
import math
import re
import time
from urllib.error import HTTPError
from urllib.request import Request, HTTPRedirectHandler, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError('webhook redirect refused')


def http_request(method, url, body):
    data = None if body is None else json.dumps(body).encode()
    req = Request(url, data=data, method=method,
                  headers={'Content-Type': 'application/json', 'User-Agent': 'Hermes-GitHub-Events/1'})
    with build_opener(NoRedirect()).open(req, timeout=20) as response:
        return json.load(response)


class DeliveryError(Exception):
    """Failure described only by stage, HTTP status, exception class name, and 429 retry_after.

    Never holds or prints the webhook URL, payload text, or exception messages.
    """

    def __init__(self, stage, *, status=None, cause=None, retry_after=None):
        super().__init__(stage)
        self.stage = stage
        self.status = status
        self.cause_name = None if cause is None else type(cause).__name__
        self.retry_after = retry_after

    def describe(self):
        parts = ['stage=' + self.stage]
        if self.status is not None:
            parts.append('status=' + str(self.status))
        if self.cause_name is not None:
            parts.append('exc=' + self.cause_name)
        if self.retry_after is not None:
            parts.append('retry_after=' + repr(self.retry_after))
        return ' '.join(parts)


def read_retry_after(error):
    try:
        if error.code != 429:
            return None
        return float(json.load(error)['retry_after'])
    except (ValueError, KeyError, TypeError):
        return None
    finally:
        error.close()


def send_event(webhook, payload, *, request=http_request, sleep=time.sleep):
    if not re.fullmatch(r'https://discord\.com/api(?:/v\d+)?/webhooks/[0-9]+/[A-Za-z0-9._-]+', webhook):
        raise DeliveryError('validate')

    def bounded_request(stage, method, url, body):
        for attempt in range(4):
            try:
                return request(method, url, body)
            except HTTPError as error:
                retry_after = read_retry_after(error)
                if error.code != 429 or attempt == 3:
                    raise DeliveryError(stage, status=error.code, retry_after=retry_after) from None
                if retry_after is None or not math.isfinite(retry_after) or not 0 <= retry_after <= 30:
                    raise DeliveryError(stage, status=error.code, retry_after=retry_after) from None
                sleep(retry_after)
            except Exception as error:
                raise DeliveryError(stage, cause=error) from None
        raise DeliveryError(stage, status=429)

    posted = bounded_request('post', 'POST', webhook + '?wait=true', payload)
    if not isinstance(posted, dict) or not re.fullmatch(r'[0-9]+', str(posted.get('id', ''))):
        raise DeliveryError('post')
    message_id = str(posted['id'])
    received = bounded_request('readback', 'GET', webhook + '/messages/' + message_id, None)
    try:
        verified = (str(received.get('id')) == message_id and received.get('content') == payload['content']
                    and bool(int(received.get('flags', 0)) & 4096))
    except (AttributeError, TypeError, ValueError):
        verified = False
    if not verified:
        raise DeliveryError('readback')
    return message_id

SENTINEL = 'HERMES_GITHUB_EVENT_V1\n'


def build_event(name, payload):
    actions = {'pull_request_target': {'opened', 'reopened', 'synchronize', 'closed', 'ready_for_review', 'converted_to_draft', 'edited'},
               'pull_request_review': {'submitted', 'dismissed', 'edited'},
               'workflow_run': {'requested', 'in_progress', 'completed'}}
    if name not in actions or payload.get('action') not in actions[name]:
        raise ValueError('unsupported event or action')
    event = {'schema_version': 1,
             'event': 'pull_request' if name == 'pull_request_target' else name,
             'repo': payload['repository']['full_name'], 'pr_number': None,
             'run_id': None, 'run_attempt': None, 'head_sha': None,
             'action': payload['action']}
    if name == 'workflow_run':
        run = payload['workflow_run']
        if run['name'] not in {'CI', 'Policy', 'E2E', 'Automerge dev'}:
            raise ValueError('unsupported source workflow')
        prs = run.get('pull_requests') or []
        # An empty/multi-PR association must never be guessed from a branch.
        event.update(pr_number=prs[0]['number'] if len(prs) == 1 else None,
                     run_id=run['id'], run_attempt=run['run_attempt'], head_sha=run['head_sha'])
        identity = [name, payload['action'], run['id'], run['run_attempt'], run['status'], run.get('conclusion')]
    else:
        pr = payload['pull_request']
        event.update(pr_number=pr['number'], head_sha=pr['head']['sha'])
        identity = [name, payload['action'], pr['id'], pr['head']['sha'], pr['updated_at']]
        if name == 'pull_request_review':
            review = payload['review']
            # Review edits may not advance PR.updated_at. Hash actual payload
            # for distinct edits; review text is never emitted or logged.
            identity.extend([review['id'], review.get('submitted_at'),
                             hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(',', ':')).encode()).hexdigest()])
        elif payload['action'] == 'edited':
            identity.append(payload.get('changes'))
    event['event_id'] = hashlib.sha256(json.dumps(identity, separators=(',', ':'), sort_keys=True).encode()).hexdigest()
    return event


def discord_payload(event):
    content = SENTINEL + json.dumps(event, separators=(',', ':'), sort_keys=True, ensure_ascii=True)
    if len(content) > 2000:
        raise ValueError('event exceeds Discord content limit')
    return {'content': content, 'flags': 4096, 'allowed_mentions': {'parse': []}}


def main(argv=None):
    import argparse
    import os
    from pathlib import Path
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run', action='store_true', help='print structured payload; never contact Discord')
    args = parser.parse_args(argv)
    try:
        raw = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text(encoding='utf-8'))
        if raw['repository']['full_name'] != os.environ['GITHUB_REPOSITORY']:
            raise ValueError('event repository mismatch')
        event = build_event(os.environ['GITHUB_EVENT_NAME'], raw)
        wire = discord_payload(event)
        if args.dry_run:
            print(json.dumps(wire, separators=(',', ':'), sort_keys=True))
            return 0
        webhook = os.environ.get('HERMES_DISCORD_EVENTS_WEBHOOK', '')
        if not webhook:
            print('notifier failed: webhook unavailable (check repository secret and fork-event restrictions)')
            return 1
        message_id = send_event(webhook, wire)
        print('notifier verified event_id=' + event['event_id'] + ' message_id=' + message_id)
        return 0
    except DeliveryError as error:
        # Only stage, HTTP status, exception class name, and 429 retry_after are printed.
        print('notifier failed: ' + error.describe() + '; no verified receipt')
        return 1
    except Exception as error:
        # Exception messages/tracebacks may contain a token-bearing URL.
        # Print the class name only; never exception values, payload text, or webhook URLs.
        print('notifier failed: stage=validate exc=' + type(error).__name__ + '; no verified receipt')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
