// 운영자 CLI: 암호화된 DB 덤프를 대상 DB에 복원한다 (PRD BAK-010 ①, DEPLOYMENT_PLAN 8.3).
//   pnpm backup:restore --from=<S3 키 또는 파일> --identity=<age 개인키 파일> --target=<DB URL> [--force]
// 개인키는 서버 밖에 보관한 파일이다. 대상 DB에 이미 테이블이 있으면 --force 없이는 거부한다.
import { existsSync, readFileSync } from "node:fs";
import { COUNTED_TABLES, restoreFromDump } from "@fmerp/feature-backup/operator";
import { ObjectStorage } from "@fmerp/storage";
import { Client } from "pg";
import { env } from "../env";
import { need, parseArgs } from "./args";

const args = parseArgs(process.argv.slice(2));
const from = need(args, "from");
const identity = readFileSync(need(args, "identity"), "utf8");
const target = need(args, "target");

const storage = new ObjectStorage({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  bucket: env.S3_BUCKET,
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
});

const client = new Client({ connectionString: target });
await client.connect();
try {
  const { rows } = await client.query<{ n: number }>(
    "select count(*)::int as n from pg_tables where schemaname = 'public'",
  );
  if ((rows[0]?.n ?? 0) > 0 && args.force !== true) {
    console.error(
      "대상 DB가 비어 있지 않습니다. 새 DB에 복원하거나 --force로 덮어쓰기를 확인하세요.",
    );
    process.exit(2);
  }
  await restoreFromDump({
    storage,
    source: existsSync(from) ? { file: from } : { key: from },
    identity,
    restoreTool: { command: env.PG_RESTORE_COMMAND, url: target },
  });
  const counts: Record<string, number> = {};
  for (const t of COUNTED_TABLES) {
    const r = await client.query<{ n: number }>(`select count(*)::int as n from ${t}`);
    counts[t] = r.rows[0]?.n ?? 0;
  }
  console.log(JSON.stringify({ ok: true, restored: counts }));
} catch (error) {
  console.error(
    JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
  );
  process.exitCode = 1;
} finally {
  await client.end();
}
