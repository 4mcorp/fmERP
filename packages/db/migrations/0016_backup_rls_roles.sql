-- 덤프·내보내기 테이블의 권한·RLS·이력 보호 트리거 (M7, docs/plan/2026-10-05-m7-backup-export-migration.md)
-- fmerp_backup 역할(BYPASSRLS + pg_read_all_data)은 docker/postgres/initdb/01-roles.sh가 만든다.
-- 이미 만들어진 DB 볼륨에는 그 파일의 "백업 역할" SQL을 직접 실행해야 한다 (docs/ts/2026-10-05-backup-role-existing-volume.md).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fmerp_backup') THEN
    RAISE EXCEPTION 'fmerp_backup 역할이 없습니다. docker/postgres/initdb/01-roles.sh의 백업 역할 SQL을 먼저 실행하세요';
  END IF;
END $$;
--> statement-breakpoint

-- 시스템 덤프: 앱은 조회·요청·삭제 표시만. 상태 갱신은 worker의 백업 역할. 누구도 DELETE할 수 없다
GRANT SELECT, INSERT ON "system_backup" TO fmerp_app;
--> statement-breakpoint
GRANT UPDATE ("delete_requested_at") ON "system_backup" TO fmerp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "system_backup" TO fmerp_backup;
--> statement-breakpoint

-- 계정 내보내기: 앱은 요청·조회, worker의 백업 역할이 상태를 갱신한다
GRANT SELECT, INSERT ON "backup_job" TO fmerp_app;
--> statement-breakpoint
GRANT SELECT, UPDATE ON "backup_job" TO fmerp_backup;
--> statement-breakpoint
ALTER TABLE "backup_job" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "backup_job" TO fmerp_app
  USING (account_id = app_current_account()) WITH CHECK (account_id = app_current_account());
--> statement-breakpoint

-- 이력 보호: 끝난 덤프·내보내기 행은 바꿀 수 없다 (덤프의 삭제 표시와 내보내기 만료만 예외)
CREATE FUNCTION system_backup_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('SUCCEEDED', 'SKIPPED', 'FAILED') THEN
    IF (to_jsonb(NEW) - 'delete_requested_at') IS DISTINCT FROM (to_jsonb(OLD) - 'delete_requested_at') THEN
      RAISE EXCEPTION '끝난 덤프 이력은 바꿀 수 없습니다 (삭제 표시만 가능)';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER system_backup_before_update BEFORE UPDATE ON "system_backup"
  FOR EACH ROW EXECUTE FUNCTION system_backup_guard();
--> statement-breakpoint
CREATE FUNCTION backup_job_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'FAILED' OR OLD.status = 'EXPIRED' THEN
    RAISE EXCEPTION '끝난 내보내기 이력은 바꿀 수 없습니다';
  END IF;
  IF OLD.status = 'READY' AND NEW.status <> 'EXPIRED' THEN
    RAISE EXCEPTION '완성된 내보내기는 만료로만 바꿀 수 있습니다';
  END IF;
  IF OLD.status = 'READY' AND (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
    RAISE EXCEPTION '완성된 내보내기의 내용은 바꿀 수 없습니다';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER backup_job_before_update BEFORE UPDATE ON "backup_job"
  FOR EACH ROW EXECUTE FUNCTION backup_job_guard();
