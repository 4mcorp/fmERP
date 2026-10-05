// 운영자 CLI: DB 덤프를 지금 실행한다 (운영 배포 직전 등, PRD BAK-006).
//   pnpm backup:dump [--note="배포 직전"]
// worker와 같은 설정(.env)을 쓰고, 결과를 JSON 한 줄로 출력한다. 실패하면 종료 코드 1.
import { runManualDumpNow } from "@fmerp/backup";
import { createDatabase } from "@fmerp/db";
import { ObjectStorage } from "@fmerp/storage";
import { createBackupContext } from "../backup-config";
import { env } from "../env";

const note = process.argv.find((a) => a.startsWith("--note="))?.slice("--note=".length);

const authDb = createDatabase(env.AUTH_DATABASE_URL);
const storage = new ObjectStorage({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  bucket: env.S3_BUCKET,
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
});
const backup = createBackupContext(env, storage, authDb.db, authDb.db);

let code = 0;
try {
  if (!backup) {
    console.error("BACKUP_DATABASE_URL과 BACKUP_AGE_RECIPIENTS가 필요합니다");
    code = 2;
  } else {
    const out = await runManualDumpNow(backup.deps, { note: note ?? "CLI" });
    console.log(JSON.stringify(out));
    if (out.status !== "SUCCEEDED") code = 1;
  }
} finally {
  await backup?.close();
  await authDb.pool.end();
}
process.exit(code);
