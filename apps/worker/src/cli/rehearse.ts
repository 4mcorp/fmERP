// 운영자 CLI: 복구 리허설 (DEPLOYMENT_PLAN 8.6). 최신(또는 지정한) 덤프를 임시 DB에 복원하고
// 표별 행 수와 무작위 완료 패키지 20건의 해시를 검증한 뒤 임시 DB를 지운다.
//   pnpm backup:rehearse --identity=<age 개인키 파일> [--from=<S3 키 또는 파일>] [--sample=20] [--keep]
// 환경 변수: REHEARSAL_ADMIN_URL(임시 DB를 만들 수 있는 연결), BACKUP_DATABASE_URL(최신 덤프를 찾고 운영 DB와 견줌)
import { existsSync, readFileSync } from "node:fs";
import { createDatabase } from "@fmerp/db";
import { rehearseRestore } from "@fmerp/feature-backup/operator";
import { ObjectStorage } from "@fmerp/storage";
import { env } from "../env";
import { need, parseArgs } from "./args";

const args = parseArgs(process.argv.slice(2));
const identity = readFileSync(need(args, "identity"), "utf8");
if (!env.REHEARSAL_ADMIN_URL) {
  console.error("REHEARSAL_ADMIN_URL(임시 DB를 만들 수 있는 연결)이 필요합니다");
  process.exit(2);
}
const adminUrl = env.REHEARSAL_ADMIN_URL;
const storage = new ObjectStorage({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  bucket: env.S3_BUCKET,
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
});
const backupDb = env.BACKUP_DATABASE_URL ? createDatabase(env.BACKUP_DATABASE_URL) : null;

try {
  let source: { file: string } | { key: string };
  const from = typeof args.from === "string" ? args.from : null;
  if (from) {
    source = existsSync(from) ? { file: from } : { key: from };
  } else {
    if (!backupDb) {
      console.error("--from이 없으면 BACKUP_DATABASE_URL로 최신 덤프를 찾습니다");
      process.exit(2);
    }
    const { rows } = await backupDb.pool.query<{ storage_key: string }>(
      "select storage_key from system_backup where status = 'SUCCEEDED' and delete_requested_at is null order by finished_at desc limit 1",
    );
    if (!rows[0]) {
      console.error("성공한 덤프가 없습니다");
      process.exit(2);
    }
    source = { key: rows[0].storage_key };
  }
  const report = await rehearseRestore(
    {
      storage,
      adminUrl,
      restoreTool: (db) => {
        const u = new URL(env.REHEARSAL_TOOL_URL ?? adminUrl);
        u.pathname = `/${db}`;
        return { command: env.PG_RESTORE_COMMAND, url: u.toString() };
      },
      sourcePool: backupDb?.pool,
    },
    {
      source,
      identity,
      sample: typeof args.sample === "string" ? Number(args.sample) : 20,
      keep: args.keep === true,
    },
  );
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
} finally {
  await backupDb?.pool.end();
}
