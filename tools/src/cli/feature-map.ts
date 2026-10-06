// pnpm feature:index | feature:find "<말>" | feature:check | feature:impact <파일…>
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  buildIndex,
  canonicalJson,
  find,
  formatHit,
  impact,
  indexJson,
  indexMarkdown,
  validate,
} from "../feature-map";
import { ROOT } from "../root";

const OUT_DIR = path.join(ROOT, "docs", "feature-map");
const JSON_FILE = path.join(OUT_DIR, "index.json");
const MD_FILE = path.join(OUT_DIR, "INDEX.md");

const [command, ...rest] = process.argv.slice(2);
const index = buildIndex(ROOT);

if (command === "index") {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(JSON_FILE, indexJson(index));
  // 저장소의 Biome 서식과 같게 맞춘다 (생성 파일도 린트 대상이다)
  execFileSync(
    process.execPath,
    [path.join(ROOT, "node_modules/@biomejs/biome/bin/biome"), "format", "--write", JSON_FILE],
    { cwd: ROOT, stdio: "ignore" },
  );
  fs.writeFileSync(MD_FILE, indexMarkdown(index));
  console.log(
    `기능 지도 색인 ${index.features.length}개 기능 → docs/feature-map/{index.json,INDEX.md}`,
  );
} else if (command === "find") {
  const query = rest.join(" ").trim();
  if (!query) {
    console.error('사용법: pnpm feature:find "<찾는 말>"  예) pnpm feature:find "알림 읽음"');
    process.exit(2);
  }
  const hits = find(index, query);
  if (hits.length === 0) {
    console.log(
      "일치하는 기능이 없습니다. 다른 낱말로 시도하거나 docs/feature-map/INDEX.md를 보세요.",
    );
    process.exit(1);
  }
  console.log(hits.slice(0, 3).map(formatHit).join("\n\n"));
} else if (command === "check") {
  const keys = [...new Set(validate(ROOT, index))].sort();
  const stale =
    !fs.existsSync(JSON_FILE) ||
    canonicalJson(fs.readFileSync(JSON_FILE, "utf8")) !== canonicalJson(indexJson(index)) ||
    !fs.existsSync(MD_FILE) ||
    fs.readFileSync(MD_FILE, "utf8") !== indexMarkdown(index);
  for (const k of keys) console.error(`  ✗ ${k}`);
  if (stale) console.error("  ✗ docs/feature-map의 색인이 최신이 아닙니다 → pnpm feature:index");
  if (keys.length > 0 || stale) process.exit(1);
  console.log(`feature:check 통과 (${index.features.length}개 기능)`);
} else if (command === "impact") {
  if (rest.length === 0) {
    console.error("사용법: pnpm feature:impact <파일…>");
    process.exit(2);
  }
  for (const f of rest) {
    const r = impact(index, f);
    console.log(`${f}\n  기능: ${r.owner ?? "(없음)"}\n  ${r.note}`);
    if (r.adapters.length) console.log(`  이 기능의 앱 어댑터: ${r.adapters.join(", ")}`);
  }
} else {
  console.error("사용법: feature-map <index|find|check|impact>");
  process.exit(2);
}
