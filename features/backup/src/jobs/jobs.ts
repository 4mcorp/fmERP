// 백업 작업 등록 (M7): 자동 일일 덤프 스케줄, 수동 덤프 요청 처리, 중단된 덤프 정리.
// web은 pg-boss를 쓰지 않으므로(M5 결정) 수동 요청은 DB 행(QUEUED)으로 남기고 worker가 짧은 주기로 집는다.

import type { PgBoss } from "pg-boss";
import { backupHealth } from "../domain/backup";
import { type BackupDeps, failStaleDumps, runDump } from "../service/dump";
import { type ExportDeps, expireExports, failStaleExports, runNextExport } from "../service/export";

export const BACKUP_AUTO = "backup.dump.auto";
const POLL_MS = 5_000;
/** 실행 중으로 남은 덤프를 중단된 것으로 보는 시간 (분). 큰 DB도 이 안에는 끝난다 */
const STALE_MINUTES = 120;
/** 내보내기는 문서가 많으면 더 오래 걸릴 수 있다 */
const EXPORT_STALE_MINUTES = 6 * 60;

export interface BackupJobs {
  stop: () => void;
}

export async function registerBackupJobs(
  boss: PgBoss,
  deps: BackupDeps,
  exportDeps: ExportDeps,
): Promise<BackupJobs> {
  // 이전 실행이 중단돼 RUNNING으로 남은 덤프는 새 덤프를 막는다. worker는 하나뿐이라 시작할 때 모두 닫는다
  const closed = await failStaleDumps(deps.pool, 0);
  if (closed > 0) console.warn(`[worker] 중단된 덤프 ${closed}건을 실패로 닫았습니다`);
  const closedExports = await failStaleExports(exportDeps.pool, 0);
  if (closedExports > 0)
    console.warn(`[worker] 중단된 내보내기 ${closedExports}건을 실패로 닫았습니다`);

  await boss.createQueue(BACKUP_AUTO);
  await boss.work(BACKUP_AUTO, async ([job]) => {
    if (!job) return;
    const out = await runDump(deps, { kind: "auto" });
    console.log(`[worker] 자동 덤프: ${out.status}`);
    // 실패는 던져서 pg-boss가 다시 시도하게 한다 (시도마다 이력이 한 건씩 남는다)
    if (out.status === "FAILED") throw new Error(out.error);
  });
  await boss.schedule(BACKUP_AUTO, "0 3 * * *", undefined, {
    tz: "Asia/Seoul",
    retryLimit: 2,
    retryDelay: 600,
  });

  // 03:00에 worker가 꺼져 있었다면 오늘 덤프가 없다. 켜질 때 누락 상태면 바로 한 번 덤프한다
  const recent = await deps.pool.query<{ status: string; kind: string; finished_at: Date | null }>(
    "select status, kind, finished_at from system_backup order by requested_at desc limit 20",
  );
  const health = backupHealth(
    (deps.now ?? (() => new Date()))(),
    recent.rows.map((r) => ({ status: r.status, kind: r.kind, finishedAt: r.finished_at })),
  );
  if (health.state === "overdue") {
    console.warn("[worker] 기한 안에 성공한 덤프가 없어 지금 한 번 실행합니다");
    await boss.send(BACKUP_AUTO, {}, { singletonKey: "catch-up" });
  }

  // 수동 덤프 요청(QUEUED)을 집는다
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    void (async () => {
      try {
        await failStaleDumps(deps.pool, STALE_MINUTES);
        const { rows } = await deps.pool.query<{
          id: string;
          requested_by_user_id: string | null;
          note: string | null;
        }>(
          "select id, requested_by_user_id, note from system_backup where status = 'QUEUED' order by requested_at limit 1",
        );
        const next = rows[0];
        if (!next) return;
        const out = await runDump(deps, {
          kind: "manual",
          systemBackupId: next.id,
          requestedByUserId: next.requested_by_user_id,
          note: next.note ?? undefined,
        });
        console.log(`[worker] 수동 덤프: ${out.status}`);
      } catch (error) {
        console.error(
          "[worker] 수동 덤프 처리 오류",
          error instanceof Error ? error.message : error,
        );
      } finally {
        busy = false;
      }
    })();
  }, POLL_MS);

  // 계정 내보내기 요청(QUEUED)을 집는다. 오래 걸릴 수 있어 덤프와 따로 돌려 서로 막지 않는다
  let exporting = false;
  const exportTimer = setInterval(() => {
    if (exporting) return;
    exporting = true;
    void (async () => {
      try {
        await failStaleExports(exportDeps.pool, EXPORT_STALE_MINUTES);
        await expireExports(exportDeps.pool);
        const out = await runNextExport(exportDeps);
        if (out) console.log(`[worker] 계정 내보내기: ${out.status}`);
      } catch (error) {
        console.error(
          "[worker] 계정 내보내기 처리 오류",
          error instanceof Error ? error.message : error,
        );
      } finally {
        exporting = false;
      }
    })();
  }, POLL_MS);

  return {
    stop: () => {
      clearInterval(timer);
      clearInterval(exportTimer);
    },
  };
}
