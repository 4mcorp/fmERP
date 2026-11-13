-- feature: account
ALTER TABLE "membership" ADD CONSTRAINT "membership_id_account_user_unique" UNIQUE("id","account_id","user_id");
--> statement-breakpoint
CREATE TABLE "agent_token" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"secret_hash" text NOT NULL,
	"scopes" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "agent_token_hash" CHECK ("agent_token"."secret_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "agent_token_expiry" CHECK ("agent_token"."expires_at" > "agent_token"."created_at" and "agent_token"."expires_at" <= "agent_token"."created_at" + interval '30 days')
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "actor_kind" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "agent_token_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "agent_pending_action_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_token" ADD CONSTRAINT "agent_token_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_token" ADD CONSTRAINT "agent_token_membership_id_account_id_user_id_membership_id_account_id_user_id_fk" FOREIGN KEY ("membership_id","account_id","user_id") REFERENCES "public"."membership"("id","account_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_token_account_id_user_id_index" ON "agent_token" USING btree ("account_id","user_id");--> statement-breakpoint
CREATE INDEX "agent_token_membership_id_account_id_user_id_index" ON "agent_token" USING btree ("membership_id","account_id","user_id");
--> statement-breakpoint
ALTER TABLE public.agent_token ENABLE ROW LEVEL SECURITY;
CREATE POLICY agent_token_tenant ON public.agent_token TO fmerp_app
USING (account_id = public.app_current_account())
WITH CHECK (account_id = public.app_current_account());
REVOKE ALL ON public.agent_token FROM PUBLIC, fmerp_auth, fmerp_app;
GRANT SELECT, INSERT ON public.agent_token TO fmerp_app;
GRANT UPDATE (revoked_at, last_used_at) ON public.agent_token TO fmerp_app;
--> statement-breakpoint
-- 인증 전 필요한 두 열만 반환한다. 공개 id 외의 검색 조건은 받지 않는다.
CREATE FUNCTION public.lookup_agent_token(token_id uuid)
RETURNS TABLE(account_id uuid, secret_hash text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT t.account_id, t.secret_hash FROM public.agent_token AS t
  WHERE t.id = token_id AND t.revoked_at IS NULL AND t.expires_at > statement_timestamp()
$$;
REVOKE ALL ON FUNCTION public.lookup_agent_token(uuid) FROM PUBLIC, fmerp_auth;
GRANT EXECUTE ON FUNCTION public.lookup_agent_token(uuid) TO fmerp_app;
--> statement-breakpoint
CREATE FUNCTION public.agent_token_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF (to_jsonb(NEW) - 'revoked_at' - 'last_used_at') IS DISTINCT FROM
     (to_jsonb(OLD) - 'revoked_at' - 'last_used_at')
     OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'agent token is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.agent_token_immutable() FROM PUBLIC;
CREATE TRIGGER agent_token_immutable BEFORE UPDATE ON public.agent_token
FOR EACH ROW EXECUTE FUNCTION public.agent_token_immutable();