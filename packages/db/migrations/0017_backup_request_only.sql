-- 앱 역할은 덤프·내보내기 "요청"(QUEUED)만 만들 수 있다 (M7 보안 리뷰 S5).
-- 완료 상태·저장소 키·해시는 worker의 백업 역할만 채운다. 이 트리거가 없으면 앱 코드 결함이나 SQL 오류로
-- 다른 계정의 내보내기 파일이나 시스템 덤프 키를 가리키는 행이 만들어져 서명 URL로 내려받아질 수 있다.
-- 마이그레이션 소유자·백업 역할이 만드는 행(운영 도구, 시험 데이터)은 막지 않는다.
CREATE FUNCTION backup_request_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'fmerp_app' AND (
    NEW.status <> 'QUEUED'
    OR NEW.storage_key IS NOT NULL OR NEW.size IS NOT NULL OR NEW.sha256 IS NOT NULL
    OR NEW.started_at IS NOT NULL OR NEW.finished_at IS NOT NULL OR NEW.error IS NOT NULL
  ) THEN
    RAISE EXCEPTION '앱은 덤프·내보내기 요청(QUEUED)만 만들 수 있습니다' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER backup_job_request_only BEFORE INSERT ON "backup_job"
  FOR EACH ROW EXECUTE FUNCTION backup_request_only();
--> statement-breakpoint
CREATE TRIGGER system_backup_request_only BEFORE INSERT ON "system_backup"
  FOR EACH ROW EXECUTE FUNCTION backup_request_only();
