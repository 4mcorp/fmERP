#!/usr/bin/env python3
"""격리 Job 실행/수집. env·Secret·Pod 원문을 아티팩트에 저장하지 않는다."""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import shlex
import shutil
import signal
import subprocess
import sys
import tarfile
import time

HERE = Path(__file__).resolve().parent
SIGNALS = (signal.SIGINT, signal.SIGTERM, signal.SIGHUP)


class Terminated(BaseException):
    """SIGINT/SIGTERM/SIGHUP을 finally와 같은 정리 경로로 보내기 위한 신호 예외."""

    def __init__(self, signum):
        super().__init__(signum)
        self.signum = signum


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('-w', default=str(HERE.parents[2]), help='코드 worktree (템플릿은 실행기 경로 기준)')
    parser.add_argument('-t', type=int, default=1800, help='runner 실행 제한 초')
    parser.add_argument('-q', type=int, default=900, help='quota/스케줄링 대기 제한 초')
    parser.add_argument('-a', help='로컬 아티팩트 디렉터리 (비어 있어야 함)')
    parser.add_argument('-p', type=float, default=2, help='상태 조회 간격 초')
    parser.add_argument('-c', help='선택적 VM Linux 캐시 절대경로 (하위 test 전용, PVC 없음)')
    parser.add_argument('-i', default='fmerp-worker:dev', help='로컬 runner 이미지')
    parser.add_argument('command', nargs=argparse.REMAINDER)
    opts = parser.parse_args()
    if not opts.command or opts.t <= 0 or opts.q <= 0 or opts.p <= 0:
        parser.error('명령과 양수 시간 제한이 필요합니다')
    source = Path(opts.w).resolve()
    if not (source/'pnpm-lock.yaml').is_file():
        parser.error('worktree에 pnpm-lock.yaml이 없습니다')
    stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    output = Path(opts.a).expanduser().resolve() if opts.a else source/'artifacts'/'k3s-test'/stamp
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    if any(output.iterdir()):
        parser.error('아티팩트 디렉터리가 비어 있지 않습니다')

    def git(ref):
        result = subprocess.run(['git', '-C', str(source), 'rev-parse', ref], capture_output=True, text=True)
        return result.stdout.strip() if result.returncode == 0 else None

    summary = {'source': str(source), 'source_sha': git('HEAD'), 'origin_dev_sha': git('origin/dev'),
               'template_source': str(HERE), 'image': opts.i, 'outcome': 'infrastructure_error',
               'runner_script_sha256': hashlib.sha256((HERE/'run-in-container.sh').read_bytes()).hexdigest(),
               'template_sha256': hashlib.sha256((HERE/'job.tmpl.yaml').read_bytes()).hexdigest(),
               'artifact_errors': [], 'queue_seconds': None, 'runner': None}
    print('worktree SHA:', summary['source_sha'], 'origin/dev (로컬 ref):', summary['origin_dev_sha'], flush=True)
    print('현재 실행기 템플릿:', HERE, '; 코드 소스:', source, flush=True)
    print('artifacts:', output, flush=True)
    if summary['source_sha'] != summary['origin_dev_sha']:
        print('주의: worktree와 로컬 origin/dev SHA가 다릅니다 (자동 fetch 없음)', flush=True)

    def kube(*args, data=None, timeout=20, stdout=None):
        return subprocess.run(['kubectl', '--request-timeout='+str(max(1, timeout-5))+'s', '-n', 'test', *args], input=data,
                              stdout=stdout or subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)

    def get(*args):
        result = kube('get', *args, '-o', 'json')
        if result.returncode:
            raise RuntimeError('kubectl get 실패: '+ ' '.join(args))
        return json.loads(result.stdout)

    def get_job_or_none(name):
        # 자기 Job이 사라졌으면 None(NotFound), 그 밖의 조회 실패는 예외로 올린다.
        result = kube('get', 'job', name, '-o', 'json')
        if result.returncode == 0:
            return json.loads(result.stdout)
        if b'NotFound' in result.stderr or b'not found' in result.stderr:
            return None
        raise RuntimeError('kubectl get 실패: job '+name)

    job = pod = None
    collected = False

    def collect():
        nonlocal collected
        if collected:
            return
        collected = True
        if pod:
            # 비정상 종료/시간 초과에서도 이미 생성된 테스트 결과를 보존한다.
            snapshot = kube('exec', pod, '-c', 'runner', '--', 'bash', '-ec',
                            'for p in test-results playwright-report apps/web/test-results apps/web/playwright-report; do '
                            'if [ -d "/work/$p" ] && [ ! -d "/artifacts/$p" ]; then '
                            'mkdir -p "/artifacts/$p"; cp -a "/work/$p/." "/artifacts/$p/"; fi; done')
            if snapshot.returncode:
                summary['artifact_errors'].append('test result snapshot unavailable')
            logs = kube('logs', pod, '-c', 'runner', '--timestamps=true')
            (output/'runner.log').write_bytes(logs.stdout)
            if logs.returncode:
                summary['artifact_errors'].append('runner logs')
            archive_path = output/'runner-artifacts.tar'
            with archive_path.open('wb') as archive_file:
                archive = kube('exec', pod, '-c', 'runner', '--', 'tar', '-C', '/artifacts', '-cf', '-', '.',
                               timeout=120, stdout=archive_file)
            if archive.returncode:
                summary['artifact_errors'].append('runner artifacts unavailable (terminated/OOM/API error)')
            else:
                try:
                    with tarfile.open(archive_path) as tar:
                        for member in tar.getmembers():
                            target = (output/member.name).resolve()
                            if (target != output and output not in target.parents) or not (member.isfile() or member.isdir()):
                                raise ValueError('unsafe archive member')
                        # 컨테이너 uid/mode(특히 '.' 디렉터리)를 호스트에 적용하지 않는다.
                        for member in tar.getmembers():
                            target = (output/member.name).resolve()
                            if target == output:
                                continue
                            if member.isdir():
                                target.mkdir(parents=True, exist_ok=True, mode=0o700)
                            else:
                                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                                stream = tar.extractfile(member)
                                if stream is None:
                                    raise ValueError('archive file stream missing')
                                with stream, target.open('wb') as dest:
                                    shutil.copyfileobj(stream, dest)
                                target.chmod(0o600)
                    metadata = output/'runner-summary.json'
                    if metadata.exists():
                        summary['runner'] = json.loads(metadata.read_text())
                    else:
                        summary['artifact_errors'].append('runner-summary.json missing')
                except (ValueError, tarfile.TarError, OSError) as exc:
                    summary['artifact_errors'].append('invalid artifact archive: '+str(exc))
            archive_path.unlink(missing_ok=True)
            release = kube('exec', pod, '-c', 'runner', '--', 'touch', '/artifacts/collected')
            if release.returncode:
                summary['artifact_errors'].append('collector release failed (runner may already be terminated)')
        if job:
            events = get('events', '--field-selector', 'involvedObject.name='+job)
            # 이벤트 전체/환경 원문은 수집하지 않고 스케줄링 진단만 남긴다.
            selected = [{'reason': item.get('reason'), 'message': item.get('message')}
                        for item in events.get('items', []) if item.get('reason') in
                        ('FailedCreate', 'FailedScheduling', 'BackOff', 'Failed', 'DeadlineExceeded')]
            (output/'events.json').write_text(json.dumps(selected, ensure_ascii=False, indent=2))

    def cancel():
        if not job:
            return
        try:
            owned = get('job', job)
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
            owned = None
        if owned is not None and owned.get('metadata', {}).get('name') != job:
            return
        deleted = kube('delete', 'job', job, '--wait=true', '--timeout=30s', timeout=40)
        check = kube('get', 'job', job, '--ignore-not-found', '-o', 'json')
        summary['job_cancelled'] = deleted.returncode == 0 and check.returncode == 0 and not check.stdout.strip()
        if not summary['job_cancelled']:
            summary['artifact_errors'].append('Job cancellation could not be verified; server deadline remains')

    def cancel_after_error():
        if not job:
            return
        try:
            owned = get('job', job)
            if owned.get('metadata', {}).get('name') != job:
                return
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
            pass
        try:
            deleted = kube('delete', 'job', job, '--wait=true', '--timeout=30s', timeout=40)
            check = kube('get', 'job', job, '--ignore-not-found', '-o', 'json')
            summary['job_cancelled'] = deleted.returncode == 0 and check.returncode == 0 and not check.stdout.strip()
            if not summary['job_cancelled']:
                summary['artifact_errors'].append('Job cancellation could not be verified; server deadline remains')
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as exc:
            summary['artifact_errors'].append('Job cancellation could not be verified; server deadline remains: '+str(exc))

    def on_signal(signum, frame):
        # 정리 중 추가 신호는 무시한다. 정리 자체는 kubectl 타임아웃으로 상한이 있다.
        for sig in SIGNALS:
            signal.signal(sig, signal.SIG_IGN)
        raise Terminated(signum)

    for sig in SIGNALS:
        signal.signal(sig, on_signal)
    started = time.monotonic()
    run_started = None
    result_code = None
    try:
        cache_volume = {'name': 'cache', 'emptyDir': {'sizeLimit': '4Gi'}}
        if opts.c:
            from pathlib import PurePosixPath
            cache_path = PurePosixPath(opts.c)
            if not cache_path.is_absolute() or len(cache_path.parts) < 4 or '..' in cache_path.parts:
                raise ValueError('캐시는 /var/lib/fmerp-e2e-cache 같은 전용 Linux 절대경로여야 합니다')
            cache_volume = {'name': 'cache', 'hostPath': {'path': str(cache_path/'test'), 'type': 'DirectoryOrCreate'}}
        replacements = {'WORKTREE': json.dumps(str(source)), 'TIMEOUT': str(opts.t+opts.q+420),
                        'RUNNER_SCRIPT': json.dumps((HERE/'run-in-container.sh').read_text()),
                        'TEST_CMD': json.dumps(shlex.join(opts.command)), 'RUNNER_IMAGE': json.dumps(opts.i),
                        'CACHE_VOLUME': json.dumps(cache_volume),
                        'RUNNER_CACHE': json.dumps('/cache' if opts.c else '')}
        manifest = (HERE/'job.tmpl.yaml').read_text()
        for key, value in replacements.items():
            manifest = manifest.replace('${'+key+'}', value)
        created = kube('create', '-f', '-', '-o', 'name', data=manifest.encode())
        if created.returncode:
            raise RuntimeError('Job 생성 실패: '+created.stderr.decode(errors='replace'))
        job = created.stdout.decode().strip().split('/')[-1]
        summary['job'] = job
        print('job:', job, flush=True)
        result_code = None
        while True:
            now = time.monotonic()
            current = get_job_or_none(job)
            if current is None:
                # NotFound: Job이 사라졌으니 더 기다리지 않는다(무한 대기 금지).
                summary['outcome'] = 'job_lost'
                summary['error'] = 'Job이 NotFound가 되어 대기를 중단했습니다'
                collect()
                result_code = 70
                break
            state = current.get('status', {})
            pods = get('pods', '-l', 'job-name='+job).get('items', [])
            runner = None
            if pods:
                pod = pods[0]['metadata']['name']
                runner = next((c for c in pods[0].get('status', {}).get('containerStatuses', [])
                               if c['name'] == 'runner'), None)
            if runner and run_started is None and any(k in runner.get('state', {}) for k in ('running', 'terminated')):
                run_started = now
                summary['queue_seconds'] = round(now-started, 3)
            conditions = {c['type'] for c in state.get('conditions', []) if c.get('status') == 'True'}
            if 'Complete' in conditions or 'Failed' in conditions:
                collect()
                if 'Complete' in conditions:
                    result_code = 0
                    summary['outcome'] = 'passed'
                else:
                    result_code = result_code or (runner or {}).get('state', {}).get('terminated', {}).get('exitCode') or 1
                    summary['outcome'] = 'failed'
                break
            if pod and runner and not collected:
                done = kube('exec', pod, '-c', 'runner', '--', 'cat', '/artifacts/exit-code')
                if done.returncode == 0:
                    result_code = int(done.stdout.strip())
                    collect()  # runner가 아직 살아 있을 때 수집 → release → 진짜 Job terminal 대기
            if run_started is None and now-started >= opts.q:
                summary['outcome'] = 'queue_timeout'
                summary['queue_seconds'] = round(now-started, 3)
                collect()
                print('quota/스케줄링 대기 초과; events.json 확인. 이 실행의 Job만 취소합니다.', flush=True)
                cancel()
                result_code = 124
                break
            if run_started is not None and now-run_started >= opts.t+ (360 if collected else 0):
                summary['outcome'] = 'runtime_timeout'
                collect()
                cancel()
                result_code = 124
                break
            time.sleep(opts.p)
        if summary['artifact_errors'] and result_code == 0:
            result_code = 74
            summary['outcome'] = 'artifact_error'
        return result_code
    except (KeyboardInterrupt, Terminated) as exc:
        signum = getattr(exc, 'signum', signal.SIGINT)
        summary['error'] = str(exc) or 'KeyboardInterrupt'
        summary['outcome'] = 'interrupted'
        summary['signal'] = signal.Signals(signum).name
        print(summary['error'], file=sys.stderr)
        try:
            collect()
        except Exception as collection_error:
            summary['artifact_errors'].append(str(collection_error))
        cancel_after_error()
        result_code = 130 if signum == signal.SIGINT else 128 + signum
        return result_code
    except Exception as exc:
        summary['error'] = str(exc)
        print(str(exc), file=sys.stderr)
        try:
            collect()
        except Exception as collection_error:
            summary['artifact_errors'].append(str(collection_error))
        cancel_after_error()
        result_code = 70
        return result_code
    finally:
        summary['total_seconds'] = round(time.monotonic()-started, 3)
        (output/'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2)+'\n')
        print('결과:', summary['outcome'], '; summary:', output/'summary.json', flush=True)
        print('EXIT', 70 if result_code is None else result_code, flush=True)


if __name__ == '__main__':
    sys.exit(main())
