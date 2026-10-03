-- 조직·권한 테이블의 권한, 테넌트 격리(RLS), 무결성 트리거. ADR 0006, docs/rules/database.md

-- ===== 권한 (테이블마다 명시) =====
GRANT SELECT, INSERT, UPDATE ON "business" TO fmerp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "department" TO fmerp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "position", "duty" TO fmerp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "assignment" TO fmerp_app;
--> statement-breakpoint
-- 발령 이력은 추가만 한다 (ORG-035)
GRANT SELECT, INSERT ON "assignment_history" TO fmerp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "role_grant" TO fmerp_app;
--> statement-breakpoint
-- 초대 수락(테넌트 확정 전)이 프리셋 소속을 만든다
GRANT SELECT ON "business", "department", "position", "duty" TO fmerp_auth;
--> statement-breakpoint
GRANT SELECT, INSERT ON "assignment", "assignment_history" TO fmerp_auth;
--> statement-breakpoint

-- ===== RLS =====
ALTER TABLE "business" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "business" TO fmerp_app
  USING (account_id = app_current_account()) WITH CHECK (account_id = app_current_account());
--> statement-breakpoint
ALTER TABLE "department" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "department" TO fmerp_app
  USING (account_id = app_current_account()) WITH CHECK (account_id = app_current_account());
--> statement-breakpoint
ALTER TABLE "position" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "position" TO fmerp_app
  USING (account_id = app_current_account()) WITH CHECK (account_id = app_current_account());
--> statement-breakpoint
ALTER TABLE "duty" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "duty" TO fmerp_app
  USING (account_id = app_current_account()) WITH CHECK (account_id = app_current_account());
--> statement-breakpoint
ALTER TABLE "assignment" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "assignment" TO fmerp_app
  USING (account_id = app_current_account()) WITH CHECK (account_id = app_current_account());
--> statement-breakpoint
ALTER TABLE "assignment_history" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "assignment_history" TO fmerp_app
  USING (account_id = app_current_account()) WITH CHECK (account_id = app_current_account());
--> statement-breakpoint
ALTER TABLE "role_grant" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "role_grant" TO fmerp_app
  USING (account_id = app_current_account()) WITH CHECK (account_id = app_current_account());
--> statement-breakpoint

-- ===== 부서 트리: depth·path 계산과 규칙 검증 (ORG-010~013) =====
-- 사용자에게 보여 줄 판단과 문구는 packages/core가 만들고, 이 트리거는 API를 거치지 않은 쓰기까지 막는 마지막 방어선이다.
CREATE FUNCTION department_before_write() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  parent_row department%ROWTYPE;
  max_depth integer;
BEGIN
  SELECT max_dept_depth INTO max_depth FROM account WHERE id = NEW.account_id;
  IF TG_OP = 'UPDATE' AND NEW.business_id <> OLD.business_id THEN
    RAISE EXCEPTION '다른 사업자로 부서를 옮길 수 없습니다' USING ERRCODE = '23514';
  END IF;
  IF NEW.parent_id IS NULL THEN
    NEW.depth := 1;
    NEW.path := NEW.id::text;
  ELSE
    SELECT * INTO parent_row FROM department WHERE id = NEW.parent_id;
    IF NOT FOUND OR parent_row.account_id <> NEW.account_id THEN
      RAISE EXCEPTION '상위 부서를 찾을 수 없습니다' USING ERRCODE = '23514';
    END IF;
    IF parent_row.business_id <> NEW.business_id THEN
      RAISE EXCEPTION '다른 사업자의 부서 아래에 둘 수 없습니다' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' AND (parent_row.id = NEW.id OR parent_row.path LIKE OLD.path || '/%') THEN
      RAISE EXCEPTION '자기 자신이나 하위 부서 아래로는 옮길 수 없습니다' USING ERRCODE = '23514';
    END IF;
    NEW.depth := parent_row.depth + 1;
    NEW.path := parent_row.path || '/' || NEW.id::text;
  END IF;
  IF NEW.depth > max_depth THEN
    RAISE EXCEPTION '최대 % 단계까지 만들 수 있습니다', max_depth USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER department_before_write
  BEFORE INSERT OR UPDATE OF parent_id, business_id ON "department"
  FOR EACH ROW EXECUTE FUNCTION department_before_write();
--> statement-breakpoint

-- 부서를 옮기면 하위 트리의 path·depth를 함께 갱신하고, 하위 트리가 최대 뎁스를 넘으면 거부한다
CREATE FUNCTION department_after_move() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  max_depth integer;
BEGIN
  UPDATE department
    SET path = NEW.path || substr(path, length(OLD.path) + 1),
        depth = depth + (NEW.depth - OLD.depth)
    WHERE account_id = NEW.account_id AND path LIKE OLD.path || '/%';
  SELECT max_dept_depth INTO max_depth FROM account WHERE id = NEW.account_id;
  IF EXISTS (
    SELECT 1 FROM department
    WHERE account_id = NEW.account_id AND path LIKE NEW.path || '/%' AND depth > max_depth
  ) THEN
    RAISE EXCEPTION '이동하면 하위 부서가 최대 % 단계를 넘습니다', max_depth USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER department_after_move
  AFTER UPDATE OF parent_id ON "department"
  FOR EACH ROW WHEN (OLD.path IS DISTINCT FROM NEW.path)
  EXECUTE FUNCTION department_after_move();
--> statement-breakpoint

-- 최대 뎁스를 낮출 때 새 값을 넘는 부서가 있으면 거부한다 (ORG-012)
CREATE FUNCTION account_before_max_depth() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.max_dept_depth < OLD.max_dept_depth AND EXISTS (
    SELECT 1 FROM department WHERE account_id = NEW.id AND depth > NEW.max_dept_depth
  ) THEN
    RAISE EXCEPTION '새 최대 뎁스(%)를 넘는 부서가 있습니다', NEW.max_dept_depth USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER account_before_max_depth
  BEFORE UPDATE OF max_dept_depth ON "account"
  FOR EACH ROW EXECUTE FUNCTION account_before_max_depth();
--> statement-breakpoint

-- ===== 소속: 부서는 지정한 사업자에 속해야 한다 (ORG-032) =====
CREATE FUNCTION assignment_before_write() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM department
    WHERE id = NEW.department_id AND business_id = NEW.business_id AND account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION '부서가 지정한 사업자에 속하지 않습니다' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER assignment_before_write
  BEFORE INSERT OR UPDATE OF business_id, department_id ON "assignment"
  FOR EACH ROW EXECUTE FUNCTION assignment_before_write();
--> statement-breakpoint

-- ===== 역할 부여: 역할별 허용 범위와 범위 대상의 존재·소속 계정 확인 (PERM-001) =====
CREATE FUNCTION role_grant_before_write() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NOT (
    (NEW.role = 'business_admin' AND NEW.scope_type = 'business') OR
    (NEW.role IN ('approval_admin', 'hr_admin') AND NEW.scope_type IN ('account', 'business')) OR
    (NEW.role = 'auditor')
  ) THEN
    RAISE EXCEPTION '역할 "%"에는 범위 "%"를 부여할 수 없습니다', NEW.role, NEW.scope_type USING ERRCODE = '23514';
  END IF;
  IF NEW.scope_type = 'business' AND NOT EXISTS (
    SELECT 1 FROM business WHERE id = NEW.scope_id AND account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION '범위의 사업자를 찾을 수 없습니다' USING ERRCODE = '23514';
  END IF;
  IF NEW.scope_type = 'department' AND NOT EXISTS (
    SELECT 1 FROM department WHERE id = NEW.scope_id AND account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION '범위의 부서를 찾을 수 없습니다' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER role_grant_before_write
  BEFORE INSERT OR UPDATE ON "role_grant"
  FOR EACH ROW EXECUTE FUNCTION role_grant_before_write();
