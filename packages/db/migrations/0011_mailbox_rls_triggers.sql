-- 완료 처리·문서함 테이블의 권한, 테넌트 격리(RLS), 불변성 트리거, 검색 인덱스, 이관·스윕 함수. ADR 0009, docs/rules/database.md

-- ===== 권한 (테이블마다 명시) =====
GRANT SELECT, INSERT, UPDATE ON "document_package" TO fmerp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "document_recipient" TO fmerp_app;
--> statement-breakpoint
-- 열람·배부 기록은 추가만 한다
GRANT SELECT, INSERT ON "document_recipient_read" TO fmerp_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "document_distribution" TO fmerp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "document_search" TO fmerp_app;
--> statement-breakpoint

-- ===== RLS =====
ALTER TABLE "document_package" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "document_package" TO fmerp_app
  USING (account_id = app_current_account()) WITH CHECK (account_id = app_current_account());
--> statement-breakpoint
ALTER TABLE "document_recipient" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "document_recipient" TO fmerp_app
  USING (account_id = app_current_account()) WITH CHECK (account_id = app_current_account());
--> statement-breakpoint
ALTER TABLE "document_recipient_read" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "document_recipient_read" TO fmerp_app
  USING (account_id = app_current_account()) WITH CHECK (account_id = app_current_account());
--> statement-breakpoint
ALTER TABLE "document_distribution" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "document_distribution" TO fmerp_app
  USING (account_id = app_current_account()) WITH CHECK (account_id = app_current_account());
--> statement-breakpoint
ALTER TABLE "document_search" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "document_search" TO fmerp_app
  USING (account_id = app_current_account()) WITH CHECK (account_id = app_current_account());
--> statement-breakpoint

-- ===== 완료 패키지: READY가 된 뒤에는 바꿀 수 없다 (BAK-003, ADR 0009) =====
CREATE FUNCTION document_package_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD.status = 'READY' THEN
    RAISE EXCEPTION '완료된 패키지 정보는 변경할 수 없습니다' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER document_package_before_update BEFORE UPDATE ON "document_package"
  FOR EACH ROW EXECUTE FUNCTION document_package_guard();
--> statement-breakpoint

-- ===== 참조·수신·공람: 상신 뒤에는 접수만 한 번 바꿀 수 있다 =====
CREATE FUNCTION document_recipient_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  doc_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT status INTO doc_status FROM document WHERE id = NEW.document_id;
    -- 공람은 완료된 문서에도 지정할 수 있다 (APV-072)
    IF doc_status = 'DRAFT' OR (NEW.kind = 'circulate' AND doc_status = 'COMPLETED') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION '참조·수신 대상은 초안에서만 지정할 수 있습니다' USING ERRCODE = '23514';
  END IF;

  SELECT status INTO doc_status FROM document WHERE id = OLD.document_id;
  IF TG_OP = 'DELETE' THEN
    -- 문서 삭제(초안)로 인한 연쇄 삭제는 문서 행이 이미 없어 통과한다
    IF doc_status IS NULL OR doc_status = 'DRAFT' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION '상신된 문서의 수신·참조 대상은 삭제할 수 없습니다' USING ERRCODE = '23514';
  END IF;

  IF doc_status = 'DRAFT' THEN
    RETURN NEW;
  END IF;
  IF OLD.kind = 'receive' AND OLD.received_by_membership_id IS NULL AND NEW.received_by_membership_id IS NOT NULL
     AND (NEW.document_id, NEW.kind, NEW.target_membership_id, NEW.target_department_id)
         IS NOT DISTINCT FROM (OLD.document_id, OLD.kind, OLD.target_membership_id, OLD.target_department_id) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '상신된 문서의 수신·참조 대상은 바꿀 수 없습니다 (접수 제외)' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER document_recipient_guard_trg BEFORE INSERT OR UPDATE OR DELETE ON "document_recipient"
  FOR EACH ROW EXECUTE FUNCTION document_recipient_guard();
--> statement-breakpoint

-- ===== 결재선 가드: 이관 함수만 진행 중 처리자를 바꿀 수 있다 (ADM-005) =====
-- 0009의 approval_step_guard에서 마지막 분기만 바뀐다. transfer_step_assignees는 마이그레이션 계정 소유의
-- SECURITY DEFINER 함수라 그 안에서는 current_user가 fmerp_migrator다. 앱 계정이 직접 UPDATE하면 이전처럼 거부된다.
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
  ELSIF doc_status IS DISTINCT FROM 'DRAFT' THEN
    IF current_user = 'fmerp_migrator'
       AND OLD.status IN ('PENDING', 'ACTIVE', 'HELD') AND NEW.status = OLD.status
       AND (NEW.seq, NEW.type, NEW.can_finalize, NEW.quorum)
           IS NOT DISTINCT FROM (OLD.seq, OLD.type, OLD.can_finalize, OLD.quorum) THEN
      -- 이관: 처리 전 단계의 처리자만 바뀐다
      RETURN NEW;
    END IF;
    IF (NEW.seq, NEW.type, NEW.assignee_ids, NEW.can_finalize, NEW.quorum)
       IS DISTINCT FROM (OLD.seq, OLD.type, OLD.assignee_ids, OLD.can_finalize, OLD.quorum) THEN
      RAISE EXCEPTION '상신된 문서의 결재선 구성은 바꿀 수 없습니다' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- ===== 결재자 이관 (ADM-005, ORG-036) =====
-- 호출한 계정(app_current_account)의 처리 전 단계만 바꾼다. 함수가 RLS를 우회하므로 계정·상태·대상자를 직접 확인한다.
-- 단계 version을 올려 동시에 처리하려는 요청이 충돌(409)하게 한다.
CREATE FUNCTION transfer_step_assignees(p_step_id uuid, p_assignee_ids uuid[], p_snapshot jsonb)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
DECLARE
  acc uuid := app_current_account();
  step_row approval_step%ROWTYPE;
  doc_status text;
BEGIN
  IF acc IS NULL THEN
    RAISE EXCEPTION '계정이 지정되지 않았습니다' USING ERRCODE = '42501';
  END IF;
  IF p_assignee_ids IS NULL OR cardinality(p_assignee_ids) < 1 THEN
    RAISE EXCEPTION '처리자는 1명 이상이어야 합니다' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO step_row FROM approval_step WHERE id = p_step_id AND account_id = acc FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '결재 단계를 찾을 수 없습니다' USING ERRCODE = 'P0002';
  END IF;
  SELECT status INTO doc_status FROM document WHERE id = step_row.document_id AND account_id = acc;
  IF doc_status NOT IN ('IN_PROGRESS', 'ON_HOLD') OR step_row.status NOT IN ('PENDING', 'ACTIVE', 'HELD') THEN
    RAISE EXCEPTION '처리 전 단계만 이관할 수 있습니다' USING ERRCODE = '23514';
  END IF;
  IF (SELECT count(*) FROM membership WHERE id = ANY (p_assignee_ids) AND account_id = acc)
     <> (SELECT count(DISTINCT x) FROM unnest(p_assignee_ids) AS x) THEN
    RAISE EXCEPTION '같은 계정의 구성원만 처리자로 지정할 수 있습니다' USING ERRCODE = '23503';
  END IF;

  UPDATE approval_step
     SET assignee_ids = p_assignee_ids, assignee_snapshot = COALESCE(p_snapshot, '[]'::jsonb), version = version + 1
   WHERE id = p_step_id AND account_id = acc;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION transfer_step_assignees(uuid, uuid[], jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION transfer_step_assignees(uuid, uuid[], jsonb) TO fmerp_app;
--> statement-breakpoint

-- ===== 패키지 스윕 (ADR 0009) =====
-- worker가 계정을 가로질러 "패키지가 아직 없는 완료 문서"의 id만 읽는다. 문서 내용은 돌려주지 않는다.
CREATE FUNCTION pending_package_documents(p_limit integer, p_older_than interval)
  RETURNS TABLE (account_id uuid, document_id uuid)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  SELECT d.account_id, d.id
    FROM document d
    LEFT JOIN document_package p ON p.document_id = d.id
   WHERE d.status = 'COMPLETED'
     AND d.completed_at < now() - p_older_than
     AND (p.document_id IS NULL OR (p.status = 'PENDING' AND p.updated_at < now() - p_older_than AND p.attempts < 10))
   ORDER BY d.completed_at
   LIMIT least(GREATEST(p_limit, 1), 500);
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION pending_package_documents(integer, interval) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION pending_package_documents(integer, interval) TO fmerp_app;
--> statement-breakpoint

-- ===== 검색·문서함 인덱스 (APV-080~082, NFR-P03) =====
CREATE INDEX "document_title_trgm_idx" ON "document" USING gin ("title" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "document_doc_no_trgm_idx" ON "document" USING gin ("doc_no" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "document_search_body_trgm_idx" ON "document_search" USING gin ("body" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "attachment_filename_trgm_idx" ON "attachment" USING gin ("filename" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "document_completed_idx" ON "document" ("account_id", "completed_at" DESC, "id" DESC) WHERE "status" = 'COMPLETED';
--> statement-breakpoint
CREATE INDEX "document_drafter_created_idx" ON "document" ("account_id", "drafter_membership_id", "created_at" DESC, "id" DESC);
--> statement-breakpoint
CREATE INDEX "document_amount_idx" ON "document" ("account_id", "amount") WHERE "amount" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "approval_step_assignees_idx" ON "approval_step" USING gin ("assignee_ids");
