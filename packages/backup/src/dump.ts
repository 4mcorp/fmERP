// DB 덤프 (PRD BAK-005·006, AUD-023, M7 plan 2절).
// pg_dump → age 암호화 → 임시 파일(크기·SHA-256 계산) → S3 멀티파트 업로드 → 올라간 객체를 다시 해시해 검증.
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { recordAudit } from "@fmerp/audit";
import { changeToken, shouldSkipDump, type TableChangeStats } from "@fmerp/core";
import type { Db } from "@fmerp/db";
import { ObjectAlreadyExistsError, type ObjectStorage } from "@fmerp/storage";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { encryptStream } from "./age";
import { clip, type PgToolConfig, runTool, toolVersion } from "./pg-tools";

export interface BackupDeps {
  /** 백업 역할(fmerp_backup) 연결: RLS를 우회해 읽고, 덤프·내보내기 이력만 갱신한다 */
  pool: Pool;
  /** 계정 없는 시스템 행위의 감사 로그는 RLS를 우회하는 인증 DB 연결로만 쓸 수 있다 */
  authDb: Db;
  storage: ObjectStorage;
  /** age 공개키 목록 (개인키는 서버에 두지 않는다) */
  recipients: string[];
  pgDump: PgToolConfig;
  /** 임시 파일 폴더. 기본은 OS 임시 폴더 */
  tmpDir?: string;
  /** pg_dump가 이 시간(밀리초) 안에 끝나지 않으면 중단한다. 기본 90분. 멈춘 덤프가 RUNNING으로 남아 새 덤프를 막지 않게 한다 */
  timeoutMs?: number;
  now?: () => Date;
}

export interface DumpOptions {
  kind: "auto" | "manual";
  /** 수동 덤프: 요청 행의 ID(QUEUED). 자동 덤프는 행을 직접 만든다 */
  systemBackupId?: string;
  requestedByUserId?: string | null;
  note?: string;
}

export type DumpOutcome =
  | { status: "SUCCEEDED"; id: string; key: string; size: number; sha256: string }
  | { status: "SKIPPED"; id: string }
  | { status: "FAILED"; id: string; error: string }
  /** 다른 덤프가 실행 중이거나 이미 처리된 요청이라 아무것도 하지 않았다 */
  | { status: "BUSY" };

/** 덤프 제한 시간: 100명 규모 DB는 분 단위로 끝난다. 이보다 오래 걸리면 멈춘 것으로 본다 */
const DEFAULT_TIMEOUT_MS = 90 * 60_000;

const KST_OFFSET_MS = 9 * 3_600_000;
const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** 한국 시간 기준 날짜·시각 조각 */
function kstParts(date: Date) {
  const d = new Date(date.getTime() + KST_OFFSET_MS);
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
    hh: d.getUTCHours(),
    mm: d.getUTCMinutes(),
    ss: d.getUTCSeconds(),
    weekday: d.getUTCDay(),
    shifted: d,
  };
}

/** ISO 주차 (`YYYY-Www`, 한국 시간 기준) */
export function isoWeekKey(date: Date): string {
  const { shifted } = kstParts(date);
  const t = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()),
  );
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${pad(week)}`;
}

const stamp = (date: Date) => {
  const p = kstParts(date);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.hh)}${pad(p.mm)}${pad(p.ss)}`;
};

/** 덤프 객체 키 (`_system/db-dumps/…`, DEPLOYMENT_PLAN 2.1). 같은 날·같은 초에 다시 실행돼도 겹치지 않게 이력 ID 뒤 8자(UUIDv7의 앞쪽은 시각이라 겹칠 수 있다)를 넣는다 */
export const dumpKey = (kind: "auto" | "manual", date: Date, id: string) =>
  `_system/db-dumps/${kind === "auto" ? "daily" : "manual"}/${stamp(date)}_${id.slice(-8)}.dump.age`;

export const weeklyKey = (date: Date) => `_system/db-dumps/weekly/${isoWeekKey(date)}.dump.age`;

/** 변경 토큰: 업무 데이터가 바뀌었는지 보는 DB 통계. 덤프 이력 자체와 세션은 업무 데이터가 아니라 뺀다 */
export async function readChangeToken(pool: Pool): Promise<string | null> {
  try {
    const { rows } = await pool.query<{ ins: string; upd: string; del: string }>(
      `select n_tup_ins::text as ins, n_tup_upd::text as upd, n_tup_del::text as del
         from pg_stat_user_tables
        where schemaname = 'public' and relname not in ('system_backup', 'session', 'verification')`,
    );
    const stats: TableChangeStats[] = rows.map((r) => ({
      ins: BigInt(r.ins),
      upd: BigInt(r.upd),
      del: BigInt(r.del),
    }));
    return changeToken(stats);
  } catch {
    return null;
  }
}

/** 시작할 때: 이전 실행이 중단돼 RUNNING으로 남은 덤프를 실패로 닫는다 (남아 있으면 새 덤프를 막는다) */
export async function failStaleDumps(pool: Pool, olderThanMinutes: number): Promise<number> {
  const { rowCount } = await pool.query(
    `update system_backup
        set status = 'FAILED', finished_at = now(), error = '중단됨 (worker가 끝나기 전에 멈췄거나 재시작됨)'
      where status = 'RUNNING' and started_at < now() - ($1::int * interval '1 minute')`,
    [olderThanMinutes],
  );
  return rowCount ?? 0;
}

/**
 * 수동 덤프를 요청 행 없이 바로 실행한다 (운영 배포 직전 실행용 CLI, PRD BAK-006).
 * 요청 행(QUEUED)을 만든 뒤 같은 경로로 실행하므로 이력·감사 로그·동시 실행 제한이 똑같이 적용된다.
 */
export async function runManualDumpNow(
  deps: BackupDeps,
  options: { note?: string; requestedByUserId?: string | null } = {},
): Promise<DumpOutcome> {
  let id: string;
  try {
    const { rows } = await deps.pool.query<{ id: string }>(
      `insert into system_backup (kind, status, note, requested_by_user_id)
       values ('manual', 'QUEUED', $1, $2) returning id`,
      [options.note ?? null, options.requestedByUserId ?? null],
    );
    id = (rows[0] as { id: string }).id;
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return { status: "BUSY" };
    throw error;
  }
  return runDump(deps, { kind: "manual", systemBackupId: id, ...options });
}

/** 덤프를 한 건 실행한다. 한 번에 하나만 돈다(DB의 부분 고유 인덱스) */
export async function runDump(deps: BackupDeps, options: DumpOptions): Promise<DumpOutcome> {
  const now = deps.now ?? (() => new Date());
  const started = now();
  const { pool } = deps;

  // 1. 이 실행을 선점한다
  let id: string;
  if (options.kind === "manual") {
    if (!options.systemBackupId) throw new Error("수동 덤프에는 요청 행의 ID가 필요합니다");
    const { rows } = await pool.query<{ id: string }>(
      `update system_backup set status = 'RUNNING', started_at = now()
        where id = $1 and status = 'QUEUED' returning id`,
      [options.systemBackupId],
    );
    if (!rows[0]) return { status: "BUSY" };
    id = rows[0].id;
  } else {
    try {
      const { rows } = await pool.query<{ id: string }>(
        `insert into system_backup (kind, status, started_at, note)
         values ('auto', 'RUNNING', now(), $1) returning id`,
        [options.note ?? null],
      );
      id = (rows[0] as { id: string }).id;
    } catch (error) {
      // 이미 다른 덤프가 실행 중 (system_backup_single_active)
      if ((error as { code?: string }).code === "23505") return { status: "BUSY" };
      throw error;
    }
  }

  // 감사 로그를 남긴 같은 연결에서 DB 통계를 바로 반영시킨다. 그러지 않으면 이 덤프가 남긴 감사 로그가 나중에
  // 반영돼 다음 변경 토큰에 섞이고, "변경 없으면 건너뜀"이 영영 동작하지 않는다
  const audit = (result: "success" | "failure", reason?: string) =>
    deps.authDb
      .transaction(async (tx) => {
        await recordAudit(tx, {
          accountId: null,
          actorUserId: options.requestedByUserId ?? null,
          action: "backup.dump",
          target: { type: "system_backup", id, label: options.kind },
          result,
          reason,
          request: {},
        });
        await tx.execute(sql`select pg_stat_force_next_flush()`);
      })
      .catch(() => undefined);

  let workDir: string | null = null;
  let tool: ReturnType<typeof runTool> | null = null;
  let timer: NodeJS.Timeout | null = null;
  let timedOut = false;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    // 2. 자동 덤프: 직전 덤프 이후 변경이 없으면 건너뛴다
    if (options.kind === "auto") {
      const { rows: prev } = await pool.query<{ change_token: string | null }>(
        `select change_token from system_backup
          where status in ('SUCCEEDED', 'SKIPPED') and change_token is not null and id <> $1
          order by finished_at desc limit 1`,
        [id],
      );
      const current = await readChangeToken(pool);
      if (shouldSkipDump(prev[0]?.change_token ?? null, current)) {
        await audit("success", "변경 없음 — 건너뜀");
        // 감사 로그를 남긴 뒤의 토큰을 저장해야 다음 날 비교가 어긋나지 않는다
        await pool.query(
          `update system_backup set status = 'SKIPPED', finished_at = now(), change_token = $2 where id = $1`,
          [id, await readChangeToken(pool)],
        );
        return { status: "SKIPPED", id };
      }
    }

    // 3. pg_dump → 암호화 → 임시 파일
    const version = await toolVersion(deps.pgDump.command);
    workDir = await mkdtemp(join(deps.tmpDir ?? tmpdir(), "fmerp-dump-"));
    const file = join(workDir, `${randomUUID()}.age`);
    tool = runTool(deps.pgDump, [
      "-Fc",
      "--no-owner",
      "--no-acl",
      "--exclude-schema=pgboss",
      // 세션 토큰은 복원에 필요 없고 덤프가 유출되면 위험만 늘린다
      "--exclude-table-data=public.session",
      "--exclude-table-data=public.verification",
    ]);
    timer = setTimeout(() => {
      timedOut = true;
      tool?.child.kill();
    }, timeoutMs);
    const encrypted = await encryptStream(tool.stdout, deps.recipients);
    const hash = createHash("sha256");
    let size = 0;
    await pipeline(
      encrypted,
      new Transform({
        transform(chunk: Buffer, _enc, cb) {
          hash.update(chunk);
          size += chunk.length;
          cb(null, chunk);
        },
      }),
      createWriteStream(file),
    );
    // pg_dump가 도중에 실패하면 잘린 덤프가 정상 파일처럼 암호화되므로 종료 코드를 반드시 확인한다
    const { code, stderr } = await tool.done;
    if (timedOut) {
      throw new Error(
        `pg_dump가 ${Math.round(timeoutMs / 60_000)}분 안에 끝나지 않아 중단했습니다`,
      );
    }
    if (code !== 0) throw new Error(`pg_dump 실패 (종료 코드 ${code}): ${clip(stderr)}`);
    if (size === 0) throw new Error("덤프가 비어 있습니다");
    const sha256 = hash.digest("hex");

    // 4. 업로드하고 올라간 객체를 다시 해시해 검증
    const key = dumpKey(options.kind, started, id);
    await deps.storage.putStream(key, createReadStream(file), "application/octet-stream");
    const verified = await deps.storage.hashObject(key);
    if (verified.sha256 !== sha256 || verified.size !== size) {
      throw new Error("업로드한 덤프의 해시·크기가 로컬 파일과 다릅니다");
    }
    // 일요일 자동 덤프는 주간 보관본으로도 복사한다 (이미 있으면 그대로 둔다)
    if (options.kind === "auto" && kstParts(started).weekday === 0) {
      await deps.storage.copyIfAbsent(key, weeklyKey(started)).catch((e: unknown) => {
        if (!(e instanceof ObjectAlreadyExistsError)) throw e;
      });
    }

    await audit("success");
    await pool.query(
      `update system_backup
          set status = 'SUCCEEDED', finished_at = now(), size = $2, sha256 = $3, storage_key = $4,
              change_token = $5, pg_dump_version = $6
        where id = $1`,
      [id, size, sha256, key, await readChangeToken(pool), version],
    );
    return { status: "SUCCEEDED", id, key, size, sha256 };
  } catch (error) {
    tool?.child.kill();
    const message = clip(error instanceof Error ? error.message : String(error));
    await audit("failure", message);
    await pool.query(
      `update system_backup set status = 'FAILED', finished_at = now(), error = $2
        where id = $1 and status = 'RUNNING'`,
      [id, message],
    );
    return { status: "FAILED", id, error: message };
  } finally {
    if (timer) clearTimeout(timer);
    if (workDir) await rm(workDir, { recursive: true, force: true });
  }
}
