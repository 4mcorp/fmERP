-- 양식·리비전·첨부·의견 테이블의 권한, 테넌트 격리(RLS), 불변성 트리거. ADR 0008, docs/rules/database.md

-- 문서 → 양식 버전 외래 키 (스키마 파일끼리 순환 import가 되어 SQL로만 둔다)
ALTER TABLE "document" ADD CONSTRAINT "document_form_version_fk"
  FOREIGN KEY ("form_version_id", "account_id") REFERENCES "form_version"("id", "account_id");
--> statement-breakpoint
CREATE INDEX "document_form_version_idx" ON "document" ("form_version_id");
--> statement-breakpoint

-- ===== 권한 (테이블마다 명시) =====
GRANT SELECT, INSERT, UPDATE ON "form" TO fmerp_app;
--> statement-breakpoint
-- 양식 버전은 추가만 한다 (APV-005). UPDATE·DELETE 권한 없음
GRANT SELECT, INSERT ON "form_version" TO fmerp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "approval_line_template" TO fmerp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "user_form_pref" TO fmerp_app;
--> statement-breakpoint
-- 본문 저장본 색인·의견은 추가만 한다 (BAK-002, APV-042)
GRANT SELECT, INSERT ON "document_revision" TO fmerp_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "approval_comment" TO fmerp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "attachment" TO fmerp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "document_link" TO fmerp_app;
--> statement-breakpoint

-- ===== RLS =====
ALTER TABLE "form" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "form" TO fmerp_app
  USING (account_id = app_current_account()) WITH CHECK (account_id = app_current_account());
--> statement-breakpoint
ALTER TABLE "form_version" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "form_version" TO fmerp_app
  USING (account_id = app_current_account()) WITH CHECK (account_id = app_current_account());
--> statement-breakpoint
ALTER TABLE "approval_line_template" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "approval_line_template" TO fmerp_app
  USING (account_id = app_current_account()) WITH CHECK (account_id = app_current_account());
--> statement-breakpoint
ALTER TABLE "user_form_pref" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "user_form_pref" TO fmerp_app
  USING (account_id = app_current_account()) WITH CHECK (account_id = app_current_account());
--> statement-breakpoint
ALTER TABLE "document_revision" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "document_revision" TO fmerp_app
  USING (account_id = app_current_account()) WITH CHECK (account_id = app_current_account());
--> statement-breakpoint
ALTER TABLE "attachment" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "attachment" TO fmerp_app
  USING (account_id = app_current_account()) WITH CHECK (account_id = app_current_account());
--> statement-breakpoint
ALTER TABLE "approval_comment" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "approval_comment" TO fmerp_app
  USING (account_id = app_current_account()) WITH CHECK (account_id = app_current_account());
--> statement-breakpoint
ALTER TABLE "document_link" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "document_link" TO fmerp_app
  USING (account_id = app_current_account()) WITH CHECK (account_id = app_current_account());
--> statement-breakpoint

-- ===== 문서: 본문이 S3로 옮겨져 body 열이 없다. 상신 후 내용 고정·완료 후 불변은 그대로 (0006 대체) =====
CREATE OR REPLACE FUNCTION document_before_update() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD.doc_no IS NOT NULL AND NEW.doc_no IS DISTINCT FROM OLD.doc_no THEN
    RAISE EXCEPTION '문서번호는 바꿀 수 없습니다' USING ERRCODE = '23514';
  END IF;
  -- 상신된 문서의 내용(제목·양식·소속·보안 등급·본문 저장본)은 회수해 초안으로 되돌린 뒤에만 수정할 수 있다
  IF OLD.status <> 'DRAFT' AND (
    NEW.title, NEW.business_id, NEW.drafter_membership_id, NEW.drafter_snapshot, NEW.policy,
    NEW.supersedes, NEW.content_hash, NEW.form_category, NEW.form_version_id,
    NEW.security_level, NEW.urgent, NEW.desired_due_date, NEW.latest_revision
  ) IS DISTINCT FROM (
    OLD.title, OLD.business_id, OLD.drafter_membership_id, OLD.drafter_snapshot, OLD.policy,
    OLD.supersedes, OLD.content_hash, OLD.form_category, OLD.form_version_id,
    OLD.security_level, OLD.urgent, OLD.desired_due_date, OLD.latest_revision
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

-- ===== 결재 단계: 초안에서 구성하고, 진행 중에는 처리 전(PENDING) 단계의 추가·삭제만 허용 (APV-037) =====
CREATE OR REPLACE FUNCTION approval_step_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  doc_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT status INTO doc_status FROM document WHERE id = NEW.document_id;
    IF doc_status = 'DRAFT' OR (doc_status IN ('IN_PROGRESS', 'ON_HOLD') AND NEW.status = 'PENDING') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION '결재선은 초안 상태에서만 추가할 수 있습니다 (진행 중에는 처리 전 단계만)' USING ERRCODE = '23514';
  END IF;

  SELECT status INTO doc_status FROM document WHERE id = OLD.document_id;
  IF TG_OP = 'DELETE' THEN
    -- 문서 삭제(초안)로 인한 연쇄 삭제는 문서 행이 이미 없어 통과한다
    IF doc_status IS NULL OR doc_status = 'DRAFT'
       OR (doc_status IN ('IN_PROGRESS', 'ON_HOLD') AND OLD.status = 'PENDING') THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION '상신된 문서의 결재선은 삭제할 수 없습니다 (진행 중에는 처리 전 단계만)' USING ERRCODE = '23514';
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

-- ===== 본문 저장본: 초안에서만, 번호는 빈틈없이 이어서 (덮어쓰기·건너뛰기 금지) =====
CREATE FUNCTION document_revision_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  doc_row document%ROWTYPE;
BEGIN
  SELECT * INTO doc_row FROM document WHERE id = NEW.document_id;
  IF doc_row.status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION '상신된 문서에는 본문 저장본을 추가할 수 없습니다' USING ERRCODE = '23514';
  END IF;
  IF NEW.n <> doc_row.latest_revision + 1 THEN
    RAISE EXCEPTION '본문 저장본 번호는 % 이어야 합니다', doc_row.latest_revision + 1 USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER document_revision_guard
  BEFORE INSERT ON "document_revision"
  FOR EACH ROW EXECUTE FUNCTION document_revision_guard();
--> statement-breakpoint

-- ===== 첨부·관련 문서: 초안에서만 추가·삭제 =====
CREATE FUNCTION draft_only_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  doc_status text;
BEGIN
  SELECT status INTO doc_status FROM document
    WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.document_id ELSE NEW.document_id END;
  -- 문서 삭제(초안)로 인한 연쇄 삭제는 문서 행이 이미 없어 통과한다
  IF doc_status IS NOT NULL AND doc_status <> 'DRAFT' THEN
    RAISE EXCEPTION '상신된 문서의 첨부·관련 문서는 바꿀 수 없습니다 (회수 후 수정)' USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER attachment_draft_only
  BEFORE INSERT OR DELETE ON "attachment"
  FOR EACH ROW EXECUTE FUNCTION draft_only_guard();
--> statement-breakpoint
CREATE TRIGGER document_link_draft_only
  BEFORE INSERT OR DELETE ON "document_link"
  FOR EACH ROW EXECUTE FUNCTION draft_only_guard();
