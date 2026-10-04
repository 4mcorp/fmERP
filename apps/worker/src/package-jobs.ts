// 완료 패키지 생성 작업과 누락 보정 스윕 (ADR 0009)
import { type GenerateDeps, generatePackage, PackageConflictError } from "@fmerp/completion";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";

export const PACKAGE_GENERATE = "package.generate";
export const PACKAGE_SWEEP = "package.sweep";

interface PackageJob {
  accountId: string;
  documentId: string;
}

/**
 * 스윕: 완료됐지만 패키지가 없거나 PENDING으로 남은 문서를 찾아 생성 작업을 등록한다.
 * 계정을 가로질러 문서 id만 읽는 DB 함수(pending_package_documents)를 쓴다.
 * 같은 문서는 singletonKey로 한 번에 하나만 큐에 있다.
 */
export async function sweepPackages(boss: PgBoss, pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ account_id: string; document_id: string }>(
    "select * from pending_package_documents(200, interval '20 seconds')",
  );
  let queued = 0;
  for (const row of rows) {
    const id = await boss.send(
      PACKAGE_GENERATE,
      { accountId: row.account_id, documentId: row.document_id } satisfies PackageJob,
      {
        singletonKey: row.document_id,
        retryLimit: 5,
        retryDelay: 30,
        retryBackoff: true,
        // PDF 변환이 오래 걸려도 5분 안에는 끝나야 한다
        expireInSeconds: 300,
      },
    );
    if (id) queued += 1;
  }
  return queued;
}

export async function registerPackageJobs(
  boss: PgBoss,
  pool: Pool,
  deps: GenerateDeps,
): Promise<void> {
  await boss.createQueue(PACKAGE_GENERATE);
  await boss.createQueue(PACKAGE_SWEEP);

  await boss.work<PackageJob>(PACKAGE_GENERATE, async ([job]) => {
    if (!job) return;
    try {
      const result = await generatePackage(deps, job.data);
      console.log(
        `[worker] 완료 패키지 ${result.alreadyReady ? "이미 완성" : "생성"}: ${job.data.documentId}`,
      );
    } catch (error) {
      if (error instanceof PackageConflictError) {
        // 덮어쓸 수 없는 불일치: 재시도해도 같으니 FAILED로 남기고 작업은 끝낸다 (사람이 확인)
        console.error(`[worker] 완료 패키지 불일치(FAILED): ${job.data.documentId} ${error.key}`);
        return;
      }
      console.error(`[worker] 완료 패키지 생성 실패: ${job.data.documentId}`, error);
      throw error; // pg-boss가 지수 백오프로 다시 시도한다
    }
  });

  await boss.work(PACKAGE_SWEEP, async () => {
    const queued = await sweepPackages(boss, pool);
    if (queued > 0) console.log(`[worker] 완료 패키지 생성 작업 ${queued}건 등록`);
  });
  // cron은 분 단위다. 완료 후 길어야 1분 안에 PDF 생성이 시작된다
  await boss.schedule(PACKAGE_SWEEP, "* * * * *", undefined, { tz: "Asia/Seoul" });
}
