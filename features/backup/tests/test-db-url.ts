// 백업 통합 테스트(dump·rehearse) 전용 URL 도우미. 앱 코드에서 import하지 않는다.
// 호스트에서 여는 테스트 DB 연결은 모두 이 함수를 거친다. 대상(포트·DB 이름)은 readTestDbTarget이 정하고,
// 허용목록 검사는 assertTestDatabaseUrl(packages/db/test/reset-test-db.ts)을 그대로 쓴다.
import { assertTestDatabaseUrl, readTestDbTarget } from "@fmerp/db/test/reset";

/** 테스트 컨테이너의 로컬 계정(docker-compose.dev.yml). 비밀정보가 아니다. */
const TEST_SERVER_CREDENTIAL = "postgres:postgres";

/**
 * 호스트에서 테스트 서버의 `database`에 붙는 URL을 만든다.
 * 서버(localhost:TEST_DB_PORT)와 DB 이름(TEST_DB_NAME)은 허용목록 가드로 먼저 확인한다.
 * `database`는 시험이 만든 임시 DB나 관리용 `postgres` DB일 수 있어, 가드 대상은 서버다.
 */
export function testServerUrl(database: string, env: NodeJS.ProcessEnv = process.env): string {
  const target = readTestDbTarget(env);
  assertTestDatabaseUrl(
    `postgres://${TEST_SERVER_CREDENTIAL}@localhost:${target.port}/${target.name}`,
    target,
  );
  return `postgres://${TEST_SERVER_CREDENTIAL}@localhost:${target.port}/${database}`;
}

/**
 * 임시 DB 삭제 전 확인: 시험이 만든 접두어로 시작해야 하고 테스트 대상 DB(TEST_DB_NAME)와 같으면 안 된다.
 */
export function assertDroppableScratchDb(
  database: string,
  prefix: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const target = readTestDbTarget(env);
  if (database === target.name || !database.startsWith(prefix)) {
    throw new Error(`임시 DB가 아니어서 지우지 않습니다: ${database}`);
  }
}
