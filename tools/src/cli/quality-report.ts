// pnpm quality:report — artifacts/gates/*.json과 기준선·한도를 모아 artifacts/quality-report.json을 만든다.
// 이후 평가 에이전트(계획 9장)가 읽는 기계용 요약이다. 게이트가 실패해도 항상 만든다.
import fs from "node:fs";
import path from "node:path";
import { normalize, readBaseline, readLimits } from "../ratchet";
import { ARTIFACT_DIR, git, readJson } from "../root";

interface GateRun {
  name: string;
  command: string;
  exitCode: number;
  pass: boolean;
  durationMs: number;
}

const gatesDir = path.join(ARTIFACT_DIR, "gates");
const gates: GateRun[] = fs.existsSync(gatesDir)
  ? fs
      .readdirSync(gatesDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => readJson<GateRun>(path.join(gatesDir, f), null as unknown as GateRun))
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name))
  : [];

const limits = readLimits();
const ratchets = Object.fromEntries(
  Object.keys(limits).map((name) => [
    name,
    { count: normalize(readBaseline(name)).length, limit: limits[name] ?? null },
  ]),
);

const commit = (await git(["rev-parse", "HEAD"]).catch(() => "")).trim();
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  commit: commit || null,
  pass: gates.length > 0 && gates.every((g) => g.pass),
  gates,
  metrics: { ratchets },
};

fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
fs.writeFileSync(
  path.join(ARTIFACT_DIR, "quality-report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(
  `quality-report: 게이트 ${gates.length}개 중 ${gates.filter((g) => g.pass).length}개 통과 → artifacts/quality-report.json`,
);
