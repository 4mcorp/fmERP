-- 테이블 권한과 테넌트 격리(RLS). docs/rules/database.md, ADR 0005
-- 테이블 권한은 기본 권한(default privileges)이 아니라 여기서 테이블마다 명시적으로 부여한다.

-- 현재 요청의 테넌트. 앱은 트랜잭션마다 SET LOCAL app.account_id 를 실행한다 (withTenant)
CREATE FUNCTION app_current_account() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.account_id', true), '')::uuid $$;
--> statement-breakpoint

-- ===== fmerp_auth: Better Auth 전용 (BYPASSRLS) =====
GRANT SELECT, INSERT, UPDATE, DELETE ON "user", "session", "user_identity", "verification" TO fmerp_auth;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "account", "membership" TO fmerp_auth;
--> statement-breakpoint
-- 초대 수락(토큰 조회·사용 처리)은 테넌트가 정해지기 전에 일어난다
GRANT SELECT, UPDATE ON "invitation" TO fmerp_auth;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "approval_pin" TO fmerp_auth;
--> statement-breakpoint
-- 로그인·로그아웃처럼 계정 밖의 행위 기록과 본인 로그인 이력 조회. 수정·삭제는 불가 (AUD-022)
GRANT SELECT, INSERT ON "audit_log" TO fmerp_auth;
--> statement-breakpoint

-- ===== fmerp_app: 업무 데이터 (RLS 적용) =====
-- 사용자는 구성원 목록 표시에 필요한 열만 읽는다 (세션·비밀번호 등 인증 테이블은 권한 없음)
GRANT SELECT (id, name, email, image) ON "user" TO fmerp_app;
--> statement-breakpoint
GRANT SELECT, UPDATE ON "account" TO fmerp_app;
--> statement-breakpoint
GRANT SELECT, UPDATE ON "membership" TO fmerp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "invitation" TO fmerp_app;
--> statement-breakpoint
-- 감사 로그는 INSERT·SELECT만 (UPDATE·DELETE 권한 없음, AUD-022)
GRANT SELECT, INSERT ON "audit_log" TO fmerp_app;
--> statement-breakpoint

ALTER TABLE "account" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "account" TO fmerp_app
  USING (id = app_current_account()) WITH CHECK (id = app_current_account());
--> statement-breakpoint
ALTER TABLE "membership" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "membership" TO fmerp_app
  USING (account_id = app_current_account()) WITH CHECK (account_id = app_current_account());
--> statement-breakpoint
ALTER TABLE "invitation" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "invitation" TO fmerp_app
  USING (account_id = app_current_account()) WITH CHECK (account_id = app_current_account());
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "audit_log" TO fmerp_app
  USING (account_id = app_current_account()) WITH CHECK (account_id = app_current_account());
