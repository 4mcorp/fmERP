import { createDatabase } from "@fmerp/db";
import { ObjectStorage } from "@fmerp/storage";
import { serve } from "@hono/node-server";
import { PgBoss } from "pg-boss";
import { env } from "./env";
import { loadFontCss } from "./fonts";
import { createHealthApp } from "./health";
import { registerPackageJobs } from "./package-jobs";
import { closeBrowser, renderPdf } from "./render";

const HEARTBEAT = "heartbeat";

const boss = new PgBoss({ connectionString: env.DATABASE_URL, schema: "pgboss" });
boss.on("error", (error) => console.error("[worker] pg-boss 오류", error));

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
const fontCss = loadFontCss(env.FONT_DIR);
if (fontCss === "") console.warn("[worker] PDF 글꼴 폴더가 비어 있어 시스템 글꼴을 씁니다");

let ready = false;
const server = serve({ fetch: createHealthApp(() => ready).fetch, port: env.WORKER_PORT });

await boss.start();
await boss.createQueue(HEARTBEAT);
await boss.work(HEARTBEAT, async () => {
  console.log(`[worker] heartbeat ${new Date().toISOString()}`);
});
await boss.schedule(HEARTBEAT, "*/5 * * * *", undefined, { tz: "Asia/Seoul" });
await boss.send(HEARTBEAT);

await registerPackageJobs(boss, appDb.pool, {
  db: appDb.db,
  authDb: authDb.db,
  storage,
  renderPdf,
  fontCss,
});

ready = true;
console.log(`[worker] 시작됨 — health: http://localhost:${env.WORKER_PORT}/health`);

async function shutdown() {
  ready = false;
  await boss.stop({ graceful: true });
  await closeBrowser();
  server.close();
  await appDb.pool.end();
  await authDb.pool.end();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
