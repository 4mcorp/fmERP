import { serve } from "@hono/node-server";
import { PgBoss } from "pg-boss";
import { env } from "./env";
import { createHealthApp } from "./health";

const HEARTBEAT = "heartbeat";

const boss = new PgBoss({ connectionString: env.DATABASE_URL, schema: "pgboss" });
boss.on("error", (error) => console.error("[worker] pg-boss 오류", error));

let ready = false;
const server = serve({ fetch: createHealthApp(() => ready).fetch, port: env.WORKER_PORT });

await boss.start();
await boss.createQueue(HEARTBEAT);
await boss.work(HEARTBEAT, async () => {
  console.log(`[worker] heartbeat ${new Date().toISOString()}`);
});
await boss.schedule(HEARTBEAT, "*/5 * * * *", undefined, { tz: "Asia/Seoul" });
await boss.send(HEARTBEAT);

ready = true;
console.log(`[worker] 시작됨 — health: http://localhost:${env.WORKER_PORT}/health`);

async function shutdown() {
  ready = false;
  await boss.stop({ graceful: true });
  server.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
