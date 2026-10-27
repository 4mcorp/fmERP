-- feature: approval
-- approval_pin 행 삭제는 인증 역할(fmerp_auth)이 처리한다. PIN 재설정 시 기존 행을 지워야 하는데 앱 역할(fmerp_app)에는 DELETE 권한이 없다.
GRANT DELETE ON "approval_pin" TO fmerp_auth;