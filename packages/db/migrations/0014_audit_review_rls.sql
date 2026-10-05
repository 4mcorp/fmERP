-- 월간 접속 기록 점검(AUD-026)의 권한과 테넌트 격리. 점검 기록은 추가만 한다 (수정·삭제 권한 없음, AUD-022과 같은 원칙)
GRANT SELECT, INSERT ON "audit_review" TO fmerp_app;
--> statement-breakpoint
ALTER TABLE "audit_review" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "audit_review" TO fmerp_app
  USING (account_id = app_current_account()) WITH CHECK (account_id = app_current_account());
