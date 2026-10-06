// pnpm arch:check          — 모든 래칫 게이트를 기준선·한도와 비교한다 (CI·pre-push)
// pnpm arch:baseline       — 기준선을 현재 상태로 다시 쓴다. 위반이 **줄었을 때만** 쓸 수 있고 한도도 함께 낮춘다
// pnpm arch:baseline --init — 처음 만들 때만: 현재 위반 수로 한도를 정한다 (이미 한도가 있는 게이트는 그대로 둔다)
import { GATES } from "../gates";
import {
  evaluate,
  normalize,
  readBaseline,
  readLimits,
  writeBaseline,
  writeLimits,
} from "../ratchet";

const write = process.argv.includes("--write");
const init = process.argv.includes("--init");
const only = process.argv.find((a) => a.startsWith("--gate="))?.slice(7);

const limits = readLimits();
let failed = false;
const fail = (message: string) => {
  failed = true;
  console.error(`  ✗ ${message}`);
};

for (const gate of GATES.filter((g) => !only || g.name === only)) {
  const current = normalize(await gate.collect());
  const limit = limits[gate.name];

  if (write || init) {
    if (limit !== undefined && current.length > limit) {
      fail(
        `${gate.name}: 위반 ${current.length}건이 한도 ${limit}건을 넘어 기준선을 쓰지 않습니다. 위반을 고치세요 (한도를 올리는 것은 사람이 tools/baselines/limits.json을 직접 바꿔야 합니다).`,
      );
      continue;
    }
    writeBaseline(gate.name, current);
    limits[gate.name] = limit === undefined ? current.length : Math.min(limit, current.length);
    console.log(`${gate.name}: 기준선 ${current.length}건 기록 (한도 ${limits[gate.name]})`);
    continue;
  }

  console.log(`${gate.name} — ${gate.description}`);
  const result = evaluate(gate.name, readBaseline(gate.name), current, limit);
  for (const message of result.errors) fail(message);
  for (const k of result.added.slice(0, 20)) console.error(`      + ${k}`);
  if (result.added.length > 20) console.error(`      … 외 ${result.added.length - 20}건`);
  for (const k of result.removed.slice(0, 10)) console.error(`      - ${k}`);
  if (result.errors.length === 0)
    console.log(`  ✓ ${current.length}건 (기준선과 같음, 한도 ${limit})`);
}

if (write || init) writeLimits(limits);
if (failed) {
  console.error("\narch:check 실패");
  process.exit(1);
}
