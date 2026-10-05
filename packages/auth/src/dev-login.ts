/**
 * 개발용 테스트 계정 로그인 활성 여부 (M1 계획 1장).
 * 운영(NODE_ENV=production)에서 켜려고 하면 예외를 던져 서버가 기동되지 않게 한다.
 * 유일한 예외는 스테이징이다: `APP_ENV=staging`을 **명시한** 빌드만 허용한다. 스테이징은 운영과 같은 이미지로 돌아야
 * 해서 NODE_ENV=production이지만, 접근을 Cloudflare Access로 막고 테스트 데이터만 둔다 (docs/ops/staging.md).
 */
export function resolveDevTestLogin(env: {
  NODE_ENV?: string;
  DEV_TEST_LOGIN?: string;
  APP_ENV?: string;
}): boolean {
  const requested = env.DEV_TEST_LOGIN === "true";
  if (requested && env.NODE_ENV === "production" && env.APP_ENV !== "staging") {
    throw new Error(
      "DEV_TEST_LOGIN=true는 운영 환경(NODE_ENV=production)에서 사용할 수 없습니다. 환경 변수를 확인하세요.",
    );
  }
  return requested;
}
