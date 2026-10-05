-- 알림용 이벤트 조회 함수가 계정을 가로질러 돌려주던 payload(반려 의견·결재선 변경 사유 포함)를 없앤다.
-- 함수는 사건의 위치(id·계정·문서·종류)만 알려 주고, 내용은 worker가 테넌트를 지정해 RLS 아래에서 읽는다.
-- 반환 형식이 바뀌어 DROP 후 다시 만든다.
DROP FUNCTION notification_pending_events(integer, interval);
--> statement-breakpoint
CREATE FUNCTION notification_pending_events(p_limit integer, p_since interval)
  RETURNS TABLE (event_id uuid, account_id uuid, document_id uuid, type text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  SELECT e.id, e.account_id, e.document_id, e.type
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
