#!/usr/bin/env python3
"""격리 Linux Compose E2E: python3 deploy/e2e/run.py --mode production -- pnpm test:e2e"""
import argparse
import fnmatch
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import shlex
import signal
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid


def _ignored(path):
    parts = PurePosixPath(path).parts
    patterns = (".git", ".worktrees", "node_modules", ".next", "artifacts",
                "test-results", "playwright-report", "__pycache__", ".cache",
                ".pnpm-store", "coverage")
    if any(part in patterns or part.startswith(".env") or part == ".npmrc"
           for part in parts):
        return True
    name = parts[-1]
    return (name.endswith((".pem", ".key", ".p12", ".pfx", ".crt", ".cer",
                           ".der", ".sqlite", ".db")) or
            name in {"id_rsa", "id_ed25519", "credentials", "credentials.json",
                     "secrets.json"} or
            name.endswith((".log", ".pyc")))


def _tracked_sources(root):
    result = subprocess.run(["git", "-C", str(root), "ls-files", "-z", "--cached",
                             "--others", "--exclude-standard"], check=True,
                            capture_output=True)
    return sorted({os.fsdecode(item) for item in result.stdout.split(b"\0") if item
                   and not _ignored(os.fsdecode(item))
                   and (root / os.fsdecode(item)).exists()})


def _capture_source(root, stream, manifest_path):
    """검증된 git source 집합을 안전한 tar로 스트리밍하고 변경 경합을 거부한다."""
    started = time.monotonic()
    paths = _tracked_sources(root)
    digest = hashlib.sha256()
    count = 0
    manifest = []
    with tarfile.open(fileobj=stream, mode="w|", format=tarfile.PAX_FORMAT) as archive:
        for relative in paths:
            pure = PurePosixPath(relative)
            if pure.is_absolute() or ".." in pure.parts or "\\" in relative:
                raise RuntimeError(f"안전하지 않은 소스 경로: {relative!r}")
            source = root / relative
            before = source.lstat()
            resolved = source.resolve(strict=True)
            try:
                resolved.relative_to(root)
            except ValueError as error:
                raise RuntimeError(f"저장소 밖 symlink: {relative}") from error
            resolved_relative = resolved.relative_to(root).as_posix()
            if _ignored(resolved_relative):
                raise RuntimeError(f"제외 대상 파일을 가리키는 symlink: {relative}")
            if not resolved.is_file():
                raise RuntimeError(f"symlink 대상은 일반 파일이어야 합니다: {relative}")
            source = resolved
            before = source.stat()
            if not stat.S_ISREG(before.st_mode):
                raise RuntimeError(f"일반 파일만 소스로 허용됩니다: {relative}")
            data = source.read_bytes()
            after = source.stat()
            if ((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) !=
                    (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns) or
                    len(data) != after.st_size):
                raise RuntimeError(f"캡처 중 파일이 변경됐습니다: {relative}")
            mode = 0o755 if after.st_mode & 0o111 else 0o644
            info = tarfile.TarInfo(relative)
            info.size = len(data)
            info.mode = mode
            info.uid = info.gid = 0
            info.uname = info.gname = ""
            info.mtime = 0
            archive.addfile(info, io.BytesIO(data))
            digest.update(relative.encode("utf-8", "surrogateescape"))
            digest.update(b"\0")
            digest.update(hashlib.sha256(data).digest())
            manifest.append({"path": relative, "size": len(data), "mode": mode,
                             "sha256": hashlib.sha256(data).hexdigest()})
            count += 1
    # 재열거로 캡처 중 새 파일/삭제 파일 및 git 집합 변경을 탐지한다.
    if paths != _tracked_sources(root):
        raise RuntimeError("소스 경로 집합이 캡처 중 변경됐습니다")
    for entry in manifest:
        current = (root / entry["path"]).resolve(strict=True)
        if hashlib.sha256(current.read_bytes()).hexdigest() != entry["sha256"]:
            raise RuntimeError(f"캡처 후 소스 파일이 변경됐습니다: {entry['path']}")
    result = {"sha256": digest.hexdigest(), "file_count": count,
              "files": manifest, "capture_seconds": round(time.monotonic() - started, 3)}
    manifest_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("dev", "production"), default="dev")
    parser.add_argument("--timeout", type=int, default=7200)
    parser.add_argument("--artifacts", type=Path)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.timeout < 1:
        parser.error("--timeout은 양수여야 합니다")
    command = args.command
    if command[:1] == ["--"]:
        command = command[1:]
    command = command or ["pnpm", "test:e2e"]
    root = Path(__file__).resolve().parents[2]
    project = "fmerp-e2e-" + uuid.uuid4().hex
    artifacts = (args.artifacts or root / "artifacts" / project).resolve()
    # 소스나 다른 실행 결과를 덮어쓰지 않는다.
    artifacts.mkdir(parents=True, exist_ok=False, mode=0o700)
    temp_root = os.environ.get("TMPDIR")
    if temp_root:
        Path(temp_root).mkdir(parents=True, exist_ok=True)
    temp_context = tempfile.TemporaryDirectory(prefix="fmerp-e2e-", dir=temp_root)
    snapshot_path = Path(temp_context.name) / "source.tar"
    manifest_path = artifacts / "source-manifest.json"
    env = {**os.environ, "E2E_SERVER_MODE": args.mode,
           "E2E_TEST_CMD": shlex.join(command)}
    compose = ["docker", "compose", "--project-name", project,
               "--file", str(root / "docker-compose.e2e.yml")]
    errors = []
    source_manifest = None
    test_exit = None
    exit_code = 70
    started = time.monotonic()

    def interrupted(signum, _frame):
        raise InterruptedError(signum, "Compose 실행 중단")

    previous_handlers = {sig: signal.signal(sig, interrupted)
                         for sig in (signal.SIGINT, signal.SIGTERM)}

    def run(argv, **kwargs):
        if kwargs.pop("stdin_snapshot", False):
            with snapshot_path.open("rb") as snapshot:
                return subprocess.run(argv, cwd=root, env=env, stdin=snapshot,
                                      text=True, **kwargs)
        return subprocess.run(argv, cwd=root, env=env, text=True, **kwargs)

    def record_error(phase, error):
        errors.append({"phase": phase, "error": str(error)})
        print(f"{phase}: {error}", file=sys.stderr)

    try:
        # 캡처를 먼저 고정해 runner와 init SQL이 동일한 내용만 보도록 한다.
        with snapshot_path.open("wb") as snapshot:
            source_manifest = _capture_source(root, snapshot, manifest_path)
        run(compose + ["run", "-T", "--rm", "--no-deps", "prepare-runner"],
            check=True, timeout=180)
        run(compose + ["--profile", "source-transfer", "run", "-T", "--rm", "--no-deps", "source-loader"],
            check=True, timeout=180, stdin_snapshot=True)
        run(compose + ["--profile", "source-transfer", "run", "-T", "--rm", "--no-deps", "--entrypoint", "python3",
                       "source-loader", "-c",
                       "import os,sys; sys.exit(0 if os.path.isfile('/source/deploy/k8s/test/run-in-container.sh') and os.path.isfile('/source/docker/postgres/initdb/01-roles.sh') else 1)"],
            check=True, timeout=60)
        run(compose + ["up", "--detach", "runner"], check=True, timeout=180)
        run(compose + ["wait", "runner"], check=False, timeout=args.timeout)
        container = run(compose + ["ps", "--all", "--quiet", "runner"],
                        check=True, capture_output=True, timeout=30).stdout.strip()
        if not container or "\n" in container:
            raise RuntimeError("단일 runner 컨테이너를 찾지 못했습니다")
        state = json.loads(run(["docker", "inspect", "--format", "{{json .State}}", container],
                               check=True, capture_output=True, timeout=30).stdout)
        if state["Status"] != "exited":
            raise RuntimeError(f"runner가 종료되지 않았습니다: {state['Status']}")
        test_exit = int(state["ExitCode"])
        exit_code = test_exit
    except InterruptedError as error:
        exit_code = 128 + (error.errno or signal.SIGINT)
        record_error("signal", error)
    except subprocess.TimeoutExpired as error:
        exit_code = 124
        record_error("timeout", error)
    except (OSError, subprocess.SubprocessError, RuntimeError, ValueError, KeyError) as error:
        record_error("execution", error)
    finally:
        # 종료된 컨테이너도 down 이전에는 cp 가능하다. 실패/시간초과에도 로그와 출력 회수를 시도한다.
        if source_manifest is not None:
            for phase, argv in [
                ("stop", compose + ["stop", "--timeout", "15", "runner"]),
                ("artifacts", compose + ["cp", "runner:/artifacts/.", str(artifacts)]),
            ]:
                try:
                    run(argv, check=True, timeout=60)
                except (OSError, subprocess.SubprocessError) as error:
                    record_error(phase, error)
        else:
            print("source snapshot failed; runner artifacts unavailable", file=sys.stderr)
        try:
            with (artifacts / "compose.log").open("w") as log:
                run(compose + ["logs", "--no-color"], check=True,
                    stdout=log, stderr=subprocess.STDOUT, timeout=60)
        except (OSError, subprocess.SubprocessError) as error:
            record_error("logs", error)
        try:
            # UUID project의 정의된 서비스/볼륨만 정리한다. 공유 prune/down은 금지한다.
            run(compose + ["down", "--volumes", "--timeout", "30"], check=True, timeout=90)
        except (OSError, subprocess.SubprocessError) as error:
            record_error("cleanup", error)
        if exit_code == 0 and errors:
            exit_code = 74
        summary = {"project": project, "mode": args.mode, "command": command,
                   "source": source_manifest, "test_exit_code": test_exit, "exit_code": exit_code,
                   "errors": errors, "wall_seconds": round(time.monotonic() - started, 3)}
        (artifacts / "compose-summary.json").write_text(
            json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
        temp_context.cleanup()
        print(f"artifacts: {artifacts}")
        for sig, handler in previous_handlers.items():
            signal.signal(sig, handler)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
