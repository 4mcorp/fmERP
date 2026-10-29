-- feature: org
CREATE TABLE "member_identity_history" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"field" text NOT NULL,
	"old_value" text NOT NULL,
	"new_value" text NOT NULL,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "employee_seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "member_identity_history" ADD CONSTRAINT "member_identity_history_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_identity_history" ADD CONSTRAINT "member_identity_history_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_identity_history" ADD CONSTRAINT "member_identity_history_membership_id_account_id_membership_id_account_id_fk" FOREIGN KEY ("membership_id","account_id") REFERENCES "public"."membership"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_identity_history_membership_id_index" ON "member_identity_history" USING btree ("membership_id");
--> statement-breakpoint
-- 사번 자동 채번: P0000부터 계정 단위로 1씩 올린다. 멤버십이 어떤 경로로 만들어져도(Better Auth·시드·SQL) 같은 규칙을 쓰도록 트리거에 둔다.
-- 이미 쓰인 번호(수동 입력분 포함)는 건너뛰고, 한 번 부여한 번호는 재사용하지 않는다(카운터는 줄지 않는다).
CREATE FUNCTION assign_employee_no() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
DECLARE
  n integer;
  candidate text;
BEGIN
  IF NEW.employee_no IS NOT NULL THEN
    RETURN NEW;
  END IF;
  LOOP
    UPDATE account SET employee_seq = employee_seq + 1
     WHERE id = NEW.account_id
     RETURNING employee_seq - 1 INTO n;
    candidate := 'P' || lpad(n::text, 4, '0');
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM membership WHERE account_id = NEW.account_id AND employee_no = candidate
    );
  END LOOP;
  NEW.employee_no := candidate;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION assign_employee_no() FROM PUBLIC;
--> statement-breakpoint
-- 기존 구성원 중 사번이 없는 사람에게 가입 순으로 번호를 준다 (트리거 설치 전에 수행)
DO $$
DECLARE
  m record;
  n integer;
  candidate text;
BEGIN
  FOR m IN SELECT id, account_id FROM membership WHERE employee_no IS NULL ORDER BY created_at, id LOOP
    LOOP
      UPDATE account SET employee_seq = employee_seq + 1 WHERE id = m.account_id RETURNING employee_seq - 1 INTO n;
      candidate := 'P' || lpad(n::text, 4, '0');
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM membership WHERE account_id = m.account_id AND employee_no = candidate
      );
    END LOOP;
    UPDATE membership SET employee_no = candidate WHERE id = m.id;
  END LOOP;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER membership_assign_employee_no BEFORE INSERT ON membership
  FOR EACH ROW EXECUTE FUNCTION assign_employee_no();
--> statement-breakpoint
-- 사번은 불변이다: 부여된 뒤에는 누구도(관리자·앱 계정 모두) 바꾸거나 비울 수 없다
CREATE FUNCTION forbid_employee_no_change() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.employee_no IS DISTINCT FROM OLD.employee_no THEN
    RAISE EXCEPTION 'employee_no is immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER membership_employee_no_immutable BEFORE UPDATE ON membership
  FOR EACH ROW EXECUTE FUNCTION forbid_employee_no_change();
--> statement-breakpoint

-- 이름·메일 변경 이력: 추가만 (UPDATE·DELETE 권한 없음). 변경은 인증 계정(user 갱신)과 한 트랜잭션에서 기록한다
GRANT SELECT, INSERT ON "member_identity_history" TO fmerp_app, fmerp_auth;
--> statement-breakpoint
ALTER TABLE "member_identity_history" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "member_identity_history" TO fmerp_app
  USING (account_id = app_current_account()) WITH CHECK (account_id = app_current_account());
