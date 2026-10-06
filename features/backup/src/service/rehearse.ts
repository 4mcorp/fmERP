// DB 복원과 복구 리허설 (PRD BAK-010 ①, DEPLOYMENT_PLAN 8.3·8.6). 운영자 CLI가 쓴다.
import { createReadStream } from "node:fs";
import type { Readable } from "node:stream";
import { docPrefix, type ObjectStorage } from "@fmerp/storage";
import { Client, type Pool } from "pg";
import { decryptStream } from "./age";
import { clip, type PgToolConfig } from "./pg-tools";
import { restoreDump } from "./restore";
import { PackageVerifyError, verifyPackage } from "./verify";

/** 덤프 파일의 위치: 내려받은 파일 경로 또는 S3 키 */
export type DumpSource = { file: string } | { key: string };

async function openDump(storage: ObjectStorage, source: DumpSource): Promise<Readable> {
  return "file" in source ? createReadStream(source.file) : storage.getStream(source.key);
}

/** 암호화된 덤프를 개인키로 풀어 `pg_restore`로 대상 DB에 복원한다. 대상 DB가 비어 있는지는 호출하는 쪽이 확인한다 */
export async function restoreFromDump(opts: {
  storage: ObjectStorage;
  source: DumpSource;
  /** age 개인키(`AGE-SECRET-KEY-1…`). 서버에는 없고 운영자가 서버 밖에서 가져온다 */
  identity: string;
  restoreTool: PgToolConfig;
}): Promise<void> {
  const encrypted = await openDump(opts.storage, opts.source);
  const plain = await decryptStream(encrypted, opts.identity);
  await restoreDump(opts.restoreTool, plain);
}

/** 복원 결과를 비교할 표들 (업무상 의미가 큰 것) */
export const COUNTED_TABLES = [
  "account",
  "membership",
  "department",
  "document",
  "approval_step",
  "approval_action",
  "document_package",
  "audit_log",
] as const;

type TableCounts = Record<string, number>;

async function countTables(client: Pick<Client, "query">): Promise<TableCounts> {
  const out: TableCounts = {};
  for (const t of COUNTED_TABLES) {
    const { rows } = await client.query<{ n: number }>(`select count(*)::int as n from ${t}`);
    out[t] = rows[0]?.n ?? 0;
  }
  return out;
}

export interface RehearseDeps {
  storage: ObjectStorage;
  /** 임시 DB를 만들고 지울 수 있는 연결 (CREATEDB 권한. 호스트에서 접속하는 주소) */
  adminUrl: string;
  /** 임시 DB 이름 → pg_restore 도구 설정 */
  restoreTool: (database: string) => PgToolConfig;
  /** 운영 DB(읽기)와 행 수를 견주려면 넣는다. 덤프 이후 바뀐 만큼 차이가 날 수 있다 */
  sourcePool?: Pool;
}

export interface RehearseOptions {
  source: DumpSource;
  identity: string;
  /** 해시를 검증할 완료 패키지 수 (DEPLOYMENT_PLAN 8.6: 무작위 20건) */
  sample?: number;
  /** true면 복원한 임시 DB를 남긴다 (손으로 확인할 때) */
  keep?: boolean;
}

export interface RehearseReport {
  ok: boolean;
  database: string;
  restored: TableCounts;
  /** 운영 DB와 견준 결과 (sourcePool을 줬을 때) */
  source?: TableCounts;
  /** 문서 수가 운영 DB와 같은지. 덤프 이후 완료된 문서가 있으면 false일 수 있다 */
  documentCountMatches?: boolean;
  packages: { checked: number; failed: { documentId: string; reason: string }[] };
  error?: string;
  kept: boolean;
}

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** 같은 서버의 다른 DB로 접속하는 URL */
function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

/**
 * 복구 리허설: 임시 DB에 덤프를 복원하고 ① 표별 행 수 ② 무작위 완료 패키지의 해시를 검증한다.
 * 어떤 단계가 실패해도 보고서를 돌려주고(`ok: false`), 임시 DB는 `keep`이 아니면 지운다.
 */
export async function rehearseRestore(
  deps: RehearseDeps,
  options: RehearseOptions,
): Promise<RehearseReport> {
  const database = `fmerp_rehearse_${Date.now().toString(36)}`;
  const report: RehearseReport = {
    ok: false,
    database,
    restored: {},
    packages: { checked: 0, failed: [] },
    kept: false,
  };
  const admin = new Client({ connectionString: deps.adminUrl });
  await admin.connect();
  let created = false;
  try {
    await admin.query(`create database ${quoteIdent(database)}`);
    created = true;
    await restoreFromDump({
      storage: deps.storage,
      source: options.source,
      identity: options.identity,
      restoreTool: deps.restoreTool(database),
    });

    const restored = new Client({ connectionString: withDatabase(deps.adminUrl, database) });
    await restored.connect();
    try {
      report.restored = await countTables(restored);
      if (deps.sourcePool) {
        report.source = await countTables(deps.sourcePool);
        report.documentCountMatches = report.source.document === report.restored.document;
      }
      // 무작위 완료 패키지의 해시 검증: 복원된 DB가 가리키는 S3 패키지가 실제로 온전한지
      const sample = options.sample ?? 20;
      const { rows } = await restored.query<{
        id: string;
        account_id: string;
        created_at: Date;
        code: string;
      }>(
        `select d.id, d.account_id, d.created_at, b.code
           from document_package p
           join document d on d.id = p.document_id
           join business b on b.id = d.business_id
          where p.status = 'READY'
          order by random() limit $1`,
        [sample],
      );
      for (const r of rows) {
        report.packages.checked += 1;
        try {
          await verifyPackage(deps.storage, docPrefix(r.account_id, r.code, r.created_at, r.id));
        } catch (error) {
          report.packages.failed.push({
            documentId: r.id,
            reason: error instanceof PackageVerifyError ? error.message : clip(String(error)),
          });
        }
      }
    } finally {
      await restored.end();
    }
    report.ok = report.packages.failed.length === 0 && (report.restored.account ?? 0) > 0;
  } catch (error) {
    report.error = clip(error instanceof Error ? error.message : String(error));
  } finally {
    if (created && options.keep) report.kept = true;
    else if (created) {
      await admin
        .query(`drop database if exists ${quoteIdent(database)} with (force)`)
        .catch(() => undefined);
    }
    await admin.end();
  }
  return report;
}
