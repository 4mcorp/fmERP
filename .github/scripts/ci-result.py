"""선택 범위·잡 결과·아티팩트를 모두 확인한 뒤 최종 품질 리포트를 만든다."""
import datetime
import json
import os
from pathlib import Path
import re
import sys


def main():
    needs = json.loads(os.environ["NEEDS_JSON"])
    errors = []
    scope = needs.get("scope", {})
    outputs = scope.get("outputs", {})
    features = json.loads(outputs["features"])
    core = outputs.get("core")
    e2e = outputs.get("e2e")
    if (not isinstance(features, list) or any(not isinstance(name, str) or
            not re.fullmatch(r"[a-z][a-z0-9-]*", name) for name in features) or
            len(set(features)) != len(features) or core not in ("true", "false") or e2e not in ("true", "false")):
        raise ValueError("잘못되거나 누락된 scope 출력")
    expected_jobs = {"scope": "success", "static": "success",
                     "test-feature": "success" if features else "skipped",
                     "test-core": "success" if core == "true" else "skipped",
                     "test-integration": "success" if core == "true" else "skipped",
                     "e2e": "success" if e2e == "true" else "skipped"}
    for name, expected in expected_jobs.items():
        actual = needs.get(name, {}).get("result")
        if actual != expected:
            errors.append(f"{name}: expected {expected}, got {actual}")

    expected_reports = {"static": {"biome", "typecheck", "arch-check", "arch-guard"}}
    expected_reports.update({feature: {f"test-{feature}"} for feature in features})
    if core == "true":
        expected_reports["core"] = {"test-core"}
        expected_reports["integration"] = {"test-integration"}
    if e2e == "true":
        expected_reports["e2e"] = {"e2e"}
    gates = []
    static = {}
    for job, expected in expected_reports.items():
        path = Path("downloaded") / f"quality-report-{job}" / "quality-report.json"
        if not path.is_file():
            errors.append(f"누락된 리포트: {path}")
            continue
        report = json.loads(path.read_text(encoding="utf-8"))
        if job == "static":
            static = report
        job_gates = report.get("gates", [])
        if {gate.get("name") for gate in job_gates} != expected or len(job_gates) != len(expected):
            errors.append(f"{job}: 게이트 누락/중복/불일치")
        for gate in job_gates:
            if gate.get("pass") is not True or gate.get("exitCode") != 0:
                errors.append(f"실패한 게이트: {gate.get('name')}")
        gates.extend(job_gates)
    report = {
        "schemaVersion": 1,
        "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "commit": static.get("commit"),
        "pass": not errors,
        "gates": sorted(gates, key=lambda gate: gate["name"]),
        "metrics": static.get("metrics", {}),
        "scope": {"features": features, "core": core == "true"},
        "jobs": {name: value.get("result") for name, value in needs.items()},
        "errors": errors,
    }
    output = Path("artifacts/quality-report.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"quality-report: {len(gates)} gates, pass={report['pass']}")
    for error in errors:
        print(f"::error::{error}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
