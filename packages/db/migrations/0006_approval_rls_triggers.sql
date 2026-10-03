-- 결재 엔진 테이블의 권한, 테넌트 격리(RLS), 불변성 트리거. ADR 0007, docs/rules/database.md

-- ===== 권한 (테이블마다 명시) =====
GRANT SELECT, INSERT, UPDATE, DELETE ON "document" TO fmerp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "approval_step" TO fmerp_app;
--> statement-breakpoint
-- 결재 처리 기록과 이벤트는 추가만 한다 (APV-046). UPDATE·DELETE 권한 없음
GRANT SELECT, INSERT ON "approval_action" TO fmerp_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "approval_event" TO fmerp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "doc_number_series" TO fmerp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "delegation" TO fmerp_app;
--> statement-breakpoint

-- ===== RLS =====
ALTER TABLE "document" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "document" TO fmerp_app
  USING (account_id = app_current_account()) WITH CHECK (account_id = app_current_account());
--> statement-breakpoint
ALTER TABLE "approval_step" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "approval_step" TO fmerp_app
  USING (account_id = app_current_account()) WITH CHECK (account_id = app_current_account());
--> statement-breakpoint
ALTER TABLE "approval_action" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "approval_action" TO fmerp_app
  USING (account_id = app_current_account()) WITH CHECK (account_id = app_current_account());
--> statement-breakpoint
ALTER TABLE "approval_event" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "approval_event" TO fmerp_app
  USING (account_id = app_current_account()) WITH CHECK (account_id = app_current_account());
--> statement-breakpoint
ALTER TABLE "doc_number_series" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "doc_number_series" TO fmerp_app
  USING (account_id = app_current_account()) WITH CHECK (account_id = app_current_account());
--> statement-breakpoint
ALTER TABLE "delegation" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "delegation" TO fmerp_app
  USING (account_id = app_current_account()) WITH CHECK (account_id = app_current_account());
--> statement-breakpoint

-- ===== 문서: 상신 후 내용 고정, 완료 후 불변 (APV-017, APV-062) =====
-- 서비스·core가 먼저 막고, 이 트리거는 API를 거치지 않은 쓰기까지 막는 마지막 방어선이다.
CREATE FUNCTION document_before_update() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD.doc_no IS NOT NULL AND NEW.doc_no IS DISTINCT FROM OLD.doc_no THEN
    RAISE EXCEPTION '문서번호는 바꿀 수 없습니다' USING ERRCODE = '23514';
  END IF;
  -- 상신된 문서의 내용은 회수해 초안으로 되돌린 뒤에만 수정할 수 있다
  IF OLD.status <> 'DRAFT' AND (
    NEW.title, NEW.body, NEW.business_id, NEW.drafter_membership_id,
    NEW.drafter_snapshot, NEW.policy, NEW.supersedes, NEW.content_hash, NEW.form_category
  ) IS DISTINCT FROM (
    OLD.title, OLD.body, OLD.business_id, OLD.drafter_membership_id,
    OLD.drafter_snapshot, OLD.policy, OLD.supersedes, OLD.content_hash, OLD.form_category
  ) THEN
    RAISE EXCEPTION '상신된 문서의 내용은 바꿀 수 없습니다 (회수 후 수정)' USING ERRCODE = '23514';
  END IF;
  IF OLD.status IN ('COMPLETED', 'CANCELED', 'ARCHIVED') THEN
    IF (NEW.numbering, NEW.source_type, NEW.source_id, NEW.submitted_at, NEW.completed_at)
       IS DISTINCT FROM (OLD.numbering, OLD.source_type, OLD.source_id, OLD.submitted_at, OLD.completed_at) THEN
      RAISE EXCEPTION '완료된 문서는 변경할 수 없습니다' USING ERRCODE = '23514';
    END IF;
    IF NEW.status <> OLD.status AND NOT (OLD.status = 'COMPLETED' AND NEW.status IN ('CANCELED', 'ARCHIVED')) THEN
      RAISE EXCEPTION '완료된 문서의 상태를 %에서 %로 바꿀 수 없습니다', OLD.status, NEW.status
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER document_before_update
  BEFORE UPDATE ON "document"
  FOR EACH ROW EXECUTE FUNCTION document_before_update();
--> statement-breakpoint

CREATE FUNCTION document_before_delete() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD.status <> 'DRAFT' THEN
    RAISE EXCEPTION '상신된 문서는 삭제할 수 없습니다' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER document_before_delete
  BEFORE DELETE ON "document"
  FOR EACH ROW EXECUTE FUNCTION document_before_delete();
--> statement-breakpoint

-- ===== 결재 단계: 초안에서만 구성하고, 완료 후에는 후결 승인만 허용 =====
-- 진행 중 결재선 변경(APV-037)은 M4에서 별도 경로로 추가한다
CREATE FUNCTION approval_step_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  doc_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT status INTO doc_status FROM document WHERE id = NEW.document_id;
    IF doc_status IS DISTINCT FROM 'DRAFT' THEN
      RAISE EXCEPTION '결재선은 초안 상태에서만 추가할 수 있습니다' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT status INTO doc_status FROM document WHERE id = OLD.document_id;
  IF TG_OP = 'DELETE' THEN
    -- 문서 삭제(초안)로 인한 연쇄 삭제는 문서 행이 이미 없어 통과한다
    IF doc_status IS NOT NULL AND doc_status <> 'DRAFT' THEN
      RAISE EXCEPTION '상신된 문서의 결재선은 삭제할 수 없습니다' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF doc_status IN ('COMPLETED', 'CANCELED', 'ARCHIVED') THEN
    IF NOT (
      OLD.status = 'POST_PENDING' AND NEW.status = 'POST_APPROVED'
      AND (NEW.seq, NEW.type, NEW.assignee_ids, NEW.delegates, NEW.can_finalize, NEW.quorum)
          IS NOT DISTINCT FROM (OLD.seq, OLD.type, OLD.assignee_ids, OLD.delegates, OLD.can_finalize, OLD.quorum)
    ) THEN
      RAISE EXCEPTION '완료된 문서의 결재선은 변경할 수 없습니다 (후결 승인 제외)' USING ERRCODE = '23514';
    END IF;
  ELSIF doc_status IS DISTINCT FROM 'DRAFT' AND (NEW.seq, NEW.type, NEW.assignee_ids, NEW.can_finalize, NEW.quorum)
        IS DISTINCT FROM (OLD.seq, OLD.type, OLD.assignee_ids, OLD.can_finalize, OLD.quorum) THEN
    RAISE EXCEPTION '상신된 문서의 결재선 구성은 바꿀 수 없습니다' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER approval_step_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "approval_step"
  FOR EACH ROW EXECUTE FUNCTION approval_step_guard();
