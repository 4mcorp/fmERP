// 운영자 CLI: S3 완료 패키지로 DB 색인을 다시 만든다 (PRD BAK-010 ②). 덤프를 복원한 뒤, 그 이후 완료된 문서를 되살린다.
//   pnpm backup:reindex --account=<계정 ID> | --all   [--dry-run]
// 먼저 --dry-run으로 어떤 문서가 되살려지고 어떤 문서가 건너뛰어지는지 확인하세요.
// 종료 코드: 0 정상, 3 건너뛴 문서가 있음(사람이 확인), 2 인자 오류
import { reindexAccount } from "@fmerp/backup";
import { createDatabase, schema } from "@fmerp/db";
import { ObjectStorage } from "@fmerp/storage";
import { env } from "../env";
import { parseArgs } from "./args";

const args = parseArgs(process.argv.slice(2));
const dryRun = args["dry-run"] === true;
const appDb = createDatabase(env.DATABASE_URL);
const authDb = createDatabase(env.AUTH_DATABASE_URL);
const storage = new ObjectStorage({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  bucket: env.S3_BUCKET,
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
});

let code = 0;
try {
  let accountIds: string[];
  if (typeof args.account === "string") accountIds = [args.account];
  else if (args.all === true) {
    accountIds = (await authDb.db.select({ id: schema.account.id }).from(schema.account)).map(
      (a) => a.id,
    );
  } else {
    console.error("--account=<계정 ID> 또는 --all이 필요합니다");
    process.exit(2);
  }
  const results: Record<string, unknown> = {};
  for (const accountId of accountIds) {
    const r = await reindexAccount({ appDb: appDb.db, storage }, { accountId, dryRun });
    results[accountId] = r;
    if (r.skipped.length > 0) code = 3;
  }
  console.log(JSON.stringify({ dryRun, results }, null, 2));
} finally {
  await appDb.pool.end();
  await authDb.pool.end();
}
process.exit(code);
