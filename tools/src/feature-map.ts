// 기능 지도(feature.map.yaml) 읽기·검증·색인·질의 (계획 5장, P8).
// 사람이 쓰는 것은 의도(summary·keywords·access)이고, 라우트·표·화면 파일 같은 사실은 코드에서 채운다.
import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { parseSchemaTables } from "./table-ownership";

interface FeatureMap {
  id: string;
  summary: string;
  keywords: string[];
  access: { who: string; path: string; entry?: string }[];
  screens: { route: string; file: string; dom?: unknown }[];
  adapters: string[];
  api?: { entry?: string };
  jobs?: { entry?: string; queues?: string[] };
  tables?: { reads?: string[]; writes?: string[] };
  events?: { publishes?: string[]; consumes?: string[] };
  contracts?: string[];
  tests?: Record<string, string>;
  invariants?: string[];
  [key: string]: unknown;
}

export interface IndexedFeature extends FeatureMap {
  folder: string;
  routes: { method: string; path: string; file: string }[];
  tables: { owns: string[]; reads: string[]; writes: string[] };
}

export interface FeatureIndex {
  features: IndexedFeature[];
}

/** `a/{b,c}/d` 같은 중괄호 하나를 펼친다 (지도의 어댑터 목록용) */
export function expandBraces(p: string): string[] {
  const m = /\{([^{}]+)\}/.exec(p);
  if (!m?.[1]) return [p];
  return m[1].split(",").flatMap((alt) => expandBraces(p.replace(m[0], alt.trim())));
}

function loadMap(root: string, folder: string): FeatureMap | null {
  const file = path.join(root, "features", folder, "feature.map.yaml");
  if (!fs.existsSync(file)) return null;
  return parse(fs.readFileSync(file, "utf8")) as FeatureMap;
}

function listFeatureFolders(root: string): string[] {
  const dir = path.join(root, "features");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/** 라우트 파일에서 `method`·`path` 쌍을 뽑는다 (createRoute 호출) */
export function extractRoutes(source: string): { method: string; path: string }[] {
  const out: { method: string; path: string }[] = [];
  const re = /method:\s*"(get|post|put|patch|delete)",\s*path:\s*"([^"]+)"/g;
  for (let m = re.exec(source); m; m = re.exec(source))
    out.push({ method: m[1] ?? "", path: m[2] ?? "" });
  return out;
}

function walk(dir: string, filter: (f: string) => boolean): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory())
      return e.name === "node_modules" || e.name === ".next" ? [] : walk(p, filter);
    return filter(p) ? [p] : [];
  });
}

const rel = (root: string, p: string) => path.relative(root, p).split(path.sep).join("/");

/** 스키마의 @owner에서 기능별 소유 표를 모은다 */
function ownedTables(root: string): Record<string, string[]> {
  const dir = path.join(root, "packages/db/src/schema");
  const out: Record<string, string[]> = {};
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
    for (const t of parseSchemaTables(f, fs.readFileSync(path.join(dir, f), "utf8"))) {
      if (!t.owner) continue;
      const list = out[t.owner] ?? [];
      list.push(t.sqlName);
      out[t.owner] = list;
    }
  }
  for (const k of Object.keys(out)) out[k]?.sort();
  return out;
}

export function buildIndex(root: string): FeatureIndex {
  const owned = ownedTables(root);
  const features: IndexedFeature[] = [];
  for (const folder of listFeatureFolders(root)) {
    const map = loadMap(root, folder);
    if (!map) continue;
    const apiDir = path.join(root, "features", folder, "src", "api");
    const routes = walk(apiDir, (f) => f.endsWith("-routes.ts") || f.endsWith("routes.ts")).flatMap(
      (f) => extractRoutes(fs.readFileSync(f, "utf8")).map((r) => ({ ...r, file: rel(root, f) })),
    );
    routes.sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));
    features.push({
      ...map,
      folder,
      routes,
      tables: {
        owns: owned[folder] ?? [],
        reads: [...(map.tables?.reads ?? [])].sort(),
        writes: [...(map.tables?.writes ?? [])].sort(),
      },
    });
  }
  return { features };
}

/** 코드에 있는 한 줄 어댑터 페이지: `export { default } from "@fmerp/feature-x/ui/pages/y"` */
function findAdapterPages(root: string): { file: string; feature: string; target: string }[] {
  const dir = path.join(root, "apps/web/app");
  return walk(dir, (f) => /page\.tsx$/.test(f)).flatMap((f) => {
    const m = /export \{ default \} from "@fmerp\/feature-([a-z-]+)\/ui\/pages\/([^"]+)";/.exec(
      fs.readFileSync(f, "utf8"),
    );
    return m
      ? [{ file: rel(root, f), feature: m[1] ?? "", target: `src/ui/pages/${m[2]}.tsx` }]
      : [];
  });
}

/** 지도 검증 위반 키 (정렬·중복 제거 전). 0건이어야 한다 */
export function validate(root: string, index: FeatureIndex): string[] {
  const keys: string[] = [];
  const exists = (p: string) => fs.existsSync(path.join(root, p));
  const allTables = new Set(Object.values(ownedTables(root)).flat());
  const adapters = findAdapterPages(root);

  for (const f of index.features) {
    const base = `features/${f.folder}`;
    if (f.id !== f.folder) keys.push(`id-mismatch:${f.folder}:${f.id}`);
    if (!f.summary?.trim()) keys.push(`no-summary:${f.folder}`);
    if (!f.keywords?.length) keys.push(`no-keywords:${f.folder}`);
    for (const s of f.screens ?? []) {
      if (!exists(`${base}/${s.file}`)) keys.push(`screen-file-missing:${f.folder}:${s.file}`);
    }
    for (const a of f.adapters ?? []) {
      for (const p of expandBraces(a.split("#")[0]?.trim() ?? a)) {
        if (/[,[]/.test(p)) continue; // 여러 경로를 한 줄에 쓴 설명 항목은 건너뛴다
        if (!exists(p)) keys.push(`adapter-missing:${f.folder}:${p}`);
      }
    }
    for (const entry of [
      f.api?.entry && `src/${f.api.entry}.ts`,
      f.jobs?.entry && `src/${f.jobs.entry}.ts`,
    ]) {
      if (entry && !exists(`${base}/${entry}`)) keys.push(`entry-missing:${f.folder}:${entry}`);
    }
    for (const t of [...f.tables.reads, ...f.tables.writes]) {
      if (!allTables.has(t)) keys.push(`unknown-table:${f.folder}:${t}`);
      if (f.tables.owns.includes(t)) keys.push(`own-table-declared:${f.folder}:${t}`);
    }
    for (const [kind, v] of Object.entries(f.tests ?? {})) {
      for (const p of v.split(",").map((x) => x.trim().replace(/\s*\(.*$/, ""))) {
        if (!p || /[*\s]/.test(p) || !/\.(ts|tsx)$/.test(p)) continue;
        const full = p.startsWith("apps/") ? p : `${base}/${p}`;
        if (!exists(full)) keys.push(`test-missing:${f.folder}:${kind}:${p}`);
      }
    }
    // 코드에 있는 화면이 지도에 빠지지 않았는지
    const listed = new Set((f.screens ?? []).map((s) => s.file));
    for (const file of walk(path.join(root, base, "src/ui/pages"), (x) => x.endsWith(".tsx"))) {
      const r = rel(root, file).slice(base.length + 1);
      if (!listed.has(r)) keys.push(`page-not-in-map:${f.folder}:${r}`);
    }
  }
  // 어댑터 페이지(앱 라우트)가 어느 기능의 지도에도 없으면 빠진 것이다
  for (const a of adapters) {
    const f = index.features.find((x) => x.folder === a.feature);
    const listed = (f?.adapters ?? []).flatMap((x) => expandBraces(x.split("#")[0]?.trim() ?? x));
    if (!f) keys.push(`adapter-feature-missing:${a.file}`);
    else if (!listed.includes(a.file)) keys.push(`adapter-not-in-map:${a.feature}:${a.file}`);
  }
  return keys;
}

// ── 출력 ──

/** 색인 JSON의 내용 비교용 정규형 (Biome가 파일을 다시 포맷해도 같게 비교한다) */
export function canonicalJson(text: string): string {
  return JSON.stringify(JSON.parse(text));
}

export function indexJson(index: FeatureIndex): string {
  return `${JSON.stringify(index, null, 2)}\n`;
}

export function indexMarkdown(index: FeatureIndex): string {
  const lines = [
    "# 기능 지도 (생성됨 — 직접 고치지 않는다)",
    "",
    '`pnpm feature:index`가 각 `features/*/feature.map.yaml`과 코드에서 만든다. 질의: `pnpm feature:find "<말>"`, 영향: `pnpm feature:impact <파일>`.',
    "",
  ];
  for (const f of index.features) {
    const screens = (f.screens ?? []).map((s) => s.route).join(", ");
    lines.push(
      `## ${f.id} — ${f.summary}`,
      `- 키워드: ${(f.keywords ?? []).join(", ")}`,
      `- 화면: ${screens || "(없음)"} · API ${f.routes.length}개 · 폴더 \`features/${f.folder}/\``,
      `- 표: 소유 ${f.tables.owns.join(", ") || "(없음)"}${f.tables.reads.length ? ` / 읽기 ${f.tables.reads.length}개` : ""}${f.tables.writes.length ? ` / 쓰기 예외 ${f.tables.writes.length}개` : ""}`,
      `- 시험: ${Object.values(f.tests ?? {}).join(" · ")}`,
      "",
    );
  }
  return lines.join("\n");
}

export interface FindHit {
  feature: IndexedFeature;
  score: number;
  reasons: string[];
}

/** 질의어(공백 구분)와 지도의 키워드·요약·화면·표 이름을 대조한다 */
export function find(index: FeatureIndex, query: string): FindHit[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hits: FindHit[] = [];
  for (const f of index.features) {
    let score = 0;
    const reasons: string[] = [];
    const bag = (label: string, text: string, weight: number) => {
      for (const t of terms) {
        if (text.toLowerCase().includes(t)) {
          score += weight;
          reasons.push(`${label}: ${t}`);
        }
      }
    };
    bag("키워드", (f.keywords ?? []).join(" "), 3);
    bag("요약", f.summary ?? "", 2);
    bag("화면", (f.screens ?? []).map((s) => `${s.route} ${s.file}`).join(" "), 2);
    bag("접근", (f.access ?? []).map((a) => a.path).join(" "), 2);
    bag("표", f.tables.owns.join(" "), 1);
    bag("API", f.routes.map((r) => r.path).join(" "), 1);
    bag("불변식", (f.invariants ?? []).join(" "), 1);
    if (score > 0) hits.push({ feature: f, score, reasons: [...new Set(reasons)] });
  }
  return hits.sort((a, b) => b.score - a.score);
}

export function formatHit(h: FindHit): string {
  const f = h.feature;
  const out = [
    `■ ${f.id} — ${f.summary}  (점수 ${h.score}; ${h.reasons.join(", ")})`,
    `  폴더: features/${f.folder}/`,
  ];
  for (const a of f.access ?? []) out.push(`  접근: ${a.who} · ${a.path}`);
  for (const s of f.screens ?? []) out.push(`  화면: ${s.route} → features/${f.folder}/${s.file}`);
  if (f.routes.length)
    out.push(
      `  API: ${f.routes
        .slice(0, 8)
        .map((r) => `${r.method.toUpperCase()} ${r.path}`)
        .join(", ")}${f.routes.length > 8 ? ` … 외 ${f.routes.length - 8}개` : ""}`,
    );
  if (f.tables.owns.length) out.push(`  소유 표: ${f.tables.owns.join(", ")}`);
  for (const [k, v] of Object.entries(f.tests ?? {})) out.push(`  시험(${k}): ${v}`);
  return out.join("\n");
}

/** 파일이 속한 기능과, 그 기능의 코드를 쓰는 합성 루트(어댑터·진입점 import)를 알려 준다 */
export function impact(
  index: FeatureIndex,
  file: string,
): { owner: string | null; adapters: string[]; note: string } {
  const f = file.replace(/\\/g, "/");
  const m = /^features\/([^/]+)\//.exec(f);
  if (!m?.[1])
    return { owner: null, adapters: [], note: "기능 폴더 밖 파일 (공통·합성 루트·도구)" };
  const feat = index.features.find((x) => x.folder === m[1]);
  const adapters = (feat?.adapters ?? []).flatMap((a) =>
    expandBraces(a.split("#")[0]?.trim() ?? a),
  );
  const entry =
    /^features\/[^/]+\/src\/(api\/routes|api\/guards|jobs\/jobs|provisioning|operator|auth-setup)\.ts$/.test(
      f,
    );
  return {
    owner: m[1],
    adapters,
    note: entry
      ? "진입점: apps/web/server/app.ts 또는 apps/worker/src/main.ts가 직접 import한다"
      : "기능 내부 파일: 진입점·어댑터를 통해서만 밖에 노출된다",
  };
}
