import pg from "pg";
import { runMigrations } from "../src/migrate";

/** 개발 DB 포트(docker-compose.dev.yml). 어떤 환경변수로도 테스트 대상이 되지 않는다. */
const DEV_DB_PORT = 55432;
/** 공유 테스트 DB(docker-compose.dev.yml의 postgres-test). 기본 대상이다. */
const SHARED_TEST_PORT = 55433;
const SHARED_TEST_NAME = "fmerp";
/**
 * 명시적 localhost 테스트 포트 허용목록. 공유 테스트 DB와 격리 테스트 DB 포트만 쓸 수 있다.
 * 격리 환경을 새 포트로 쓰려면 여기에 등록해야 하며, 목록 밖의 포트는 이름이 맞아도 거부한다.
 */
export const ALLOWED_TEST_PORTS: readonly number[] = [SHARED_TEST_PORT, 55544];
/** 격리 테스트 DB 이름은 fmerp_로 시작하고 test를 포함해야 한다(예: fmerp_test_b2). */
const ISOLATED_TEST_NAME = /^fmerp_[a-z0-9_]*test[a-z0-9_]*$/;

export interface TestDbTarget {
  port: number;
  name: string;
}

/** 대상(포트·이름)이 허용목록에 있는지 확인한다. 개발 포트는 허용목록과 무관하게 항상 거부한다. */
function assertAllowedTarget(port: number, name: string): void {
  if (port === DEV_DB_PORT) {
    throw new Error("개발 DB 포트(55432)는 테스트 대상으로 쓸 수 없습니다");
  }
  if (!ALLOWED_TEST_PORTS.includes(port)) {
    throw new Error(`허용되지 않은 테스트 DB 포트입니다: ${port}`);
  }
  const isShared = port === SHARED_TEST_PORT && name === SHARED_TEST_NAME;
  if (!isShared && !ISOLATED_TEST_NAME.test(name)) {
    throw new Error(`허용되지 않은 테스트 DB 이름입니다: ${name}`);
  }
}

/**
 * 테스트 DB 대상(localhost 포트 + DB 이름)을 환경변수에서 읽는다.
 * TEST_DB_PORT(기본 55433)·TEST_DB_NAME(기본 fmerp). 개발 포트(55432)와 허용목록 밖의 포트·이름은 거부한다.
 * 허용: 허용 포트(ALLOWED_TEST_PORTS) × (공유 DB fmerp, 또는 이름에 test가 든 fmerp_* DB).
 */
export function readTestDbTarget(env: NodeJS.ProcessEnv = process.env): TestDbTarget {
  const rawPort = env.TEST_DB_PORT || String(SHARED_TEST_PORT);
  const name = env.TEST_DB_NAME || SHARED_TEST_NAME;
  const port = /^\d{1,5}$/.test(rawPort) ? Number(rawPort) : Number.NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`테스트 DB 포트가 올바르지 않습니다: ${rawPort}`);
  }
  assertAllowedTarget(port, name);
  return { port, name };
}

/**
 * 연결 URL이 허용된 테스트 DB(localhost의 테스트 포트 + 테스트 DB 이름)와 정확히 일치하는지 확인한다.
 * 개발·운영 URL과 허용목록 밖의 DB 이름은 모두 거부한다. 오류 메시지에 URL(비밀번호 포함)을 넣지 않는다.
 */
export function assertTestDatabaseUrl(
  url: string,
  target: TestDbTarget = readTestDbTarget(),
): void {
  assertAllowedTarget(target.port, target.name);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("테스트 DB URL을 해석할 수 없어 초기화하지 않습니다");
  }
  const allowed =
    parsed.hostname === "localhost" &&
    parsed.port === String(target.port) &&
    parsed.pathname === `/${target.name}`;
  if (!allowed) {
    throw new Error(
      `테스트 DB(localhost:${target.port}/${target.name})가 아닌 곳은 초기화하지 않습니다`,
    );
  }
}

/**
 * 테스트 전용 DB를 최신 스키마로 맞추고 public 테이블을 모두 비운다.
 * Vitest 통합 테스트와 Playwright E2E가 함께 쓴다. 허용목록 밖의 DB는 실수로라도 초기화하지 않는다.
 */
export async function resetTestDatabase(migrationUrl: string): Promise<void> {
  assertTestDatabaseUrl(migrationUrl);
  await runMigrations(migrationUrl);

  const client = new pg.Client({ connectionString: migrationUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public'",
    );
    if (rows.length > 0) {
      const tables = rows.map((r) => `"public"."${r.tablename}"`).join(", ");
      await client.query(`truncate ${tables} cascade`);
    }
  } finally {
    await client.end();
  }
}
