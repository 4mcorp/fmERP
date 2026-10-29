// 서비스 워커 제공 (PWA). 정적 파일 대신 라우트로 두어 knip이 미사용으로 보지 않게 한다.
import { serviceWorkerResponse } from "@fmerp/feature-notification/sw/service-worker";

export function GET() {
  return serviceWorkerResponse();
}
