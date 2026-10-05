-- 알림 테이블의 권한·RLS·교차 계정 조회 함수 (M8, docs/plan/2026-10-05-m8-notifications-home.md)

-- 인앱 알림: 앱은 만들고 읽음·텔레그램 상태만 바꾼다. 삭제는 없다
GRANT SELECT, INSERT ON "notification" TO fmerp_app;
--> statement-breakpoint
GRANT UPDATE ("read_at", "telegram_status") ON "notification" TO fmerp_app;
--> statement-breakpoint
ALTER TABLE "notification" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "notification" TO fmerp_app
  USING (account_id = app_current_account()) WITH CHECK (account_id = app_current_account());
--> statement-breakpoint

GRANT SELECT, INSERT ON "event_notified" TO fmerp_app;
--> statement-breakpoint
ALTER TABLE "event_notified" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "event_notified" TO fmerp_app
  USING (account_id = app_current_account()) WITH CHECK (account_id = app_current_account());
--> statement-breakpoint

-- 텔레그램 연결은 사용자 단위라 계정 RLS 대상이 아니다. 인증 역할(fmerp_auth)만 다룬다
GRANT SELECT, INSERT, UPDATE, DELETE ON "telegram_link" TO fmerp_auth;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "telegram_link_token" TO fmerp_auth;
--> statement-breakpoint

-- 서버 설정: 앱(시스템 관리자 경로, worker의 오프셋 저장)만 읽고 쓴다. 삭제는 없다
GRANT SELECT, INSERT, UPDATE ON "system_setting" TO fmerp_app;
--> statement-breakpoint

-- worker가 계정을 가로질러 "알림 처리 표시가 없는 최근 결재 이벤트"를 읽는다 (ADR 0009 스윕과 같은 방식).
-- id 커서 대신 처리 표시로 찾아, 늦게 커밋된 이벤트도 놓치지 않는다. 이벤트 종류와 문서 id·페이로드만 돌려준다.
CREATE FUNCTION notification_pending_events(p_limit integer, p_since interval)
  RETURNS TABLE (event_id uuid, account_id uuid, document_id uuid, type text, payload jsonb)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  SELECT e.id, e.account_id, e.document_id, e.type, e.payload
    FROM approval_event e
   WHERE e.created_at > now() - p_since
     AND NOT EXISTS (SELECT 1 FROM event_notified n WHERE n.event_id = e.id)
   ORDER BY e.id
   LIMIT least(GREATEST(p_limit, 1), 500);
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION notification_pending_events(integer, interval) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION notification_pending_events(integer, interval) TO fmerp_app;
