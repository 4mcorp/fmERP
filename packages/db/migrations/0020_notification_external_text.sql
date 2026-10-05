ALTER TABLE "notification" ADD COLUMN "external_text" text DEFAULT '' NOT NULL;--> statement-breakpoint

-- worker가 계정을 가로질러 "텔레그램 발송이 아직 안 끝난 알림"의 id만 읽는다 (큐 등록 누락 보정, 패키지 스윕과 같은 방식).
-- 문구·수신자는 돌려주지 않는다. 발송 작업이 테넌트를 지정해 다시 읽는다.
CREATE FUNCTION notification_pending_telegram(p_limit integer, p_older_than interval)
  RETURNS TABLE (notification_id uuid, account_id uuid)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  SELECT n.id, n.account_id
    FROM notification n
   WHERE n.telegram_status = 'PENDING'
     AND n.created_at < now() - p_older_than
     AND n.created_at > now() - interval '1 day'
   ORDER BY n.created_at
   LIMIT least(GREATEST(p_limit, 1), 500);
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION notification_pending_telegram(integer, interval) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION notification_pending_telegram(integer, interval) TO fmerp_app;
