// 백업 도구 설정 (worker와 운영자 CLI가 공유). 환경 변수 → BackupDeps
import type { BackupDeps } from "@fmerp/backup";
import { createDatabase, type Db } from "@fmerp/db";
import type { ObjectStorage } from "@fmerp/storage";
import type { env as Env } from "./env";

type WorkerEnv = typeof Env;

export interface BackupContext {
  deps: BackupDeps;
  close: () => Promise<void>;
}

/** 백업 설정이 모두 있으면 연결을 만들어 돌려주고, 하나라도 없으면 null */
export function createBackupContext(
  env: WorkerEnv,
  storage: ObjectStorage,
  authDb: Db,
): BackupContext | null {
  if (!env.BACKUP_DATABASE_URL || !env.BACKUP_AGE_RECIPIENTS) return null;
  const db = createDatabase(env.BACKUP_DATABASE_URL);
  return {
    deps: {
      pool: db.pool,
      authDb,
      storage,
      recipients: env.BACKUP_AGE_RECIPIENTS.split(",")
        .map((r) => r.trim())
        .filter(Boolean),
      pgDump: {
        command: env.PG_DUMP_COMMAND,
        url: env.BACKUP_PG_DUMP_URL ?? env.BACKUP_DATABASE_URL,
      },
    },
    close: () => db.pool.end(),
  };
}
