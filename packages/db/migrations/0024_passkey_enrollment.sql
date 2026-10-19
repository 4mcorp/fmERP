-- feature: account
-- passkey(WebAuthn) 자격 증명과 사전 등록 1회용 토큰 (PK1a, docs/plan/2026-10-20-passkey-auth.md)

CREATE TABLE "passkey" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"aaguid" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "passkey_credentialID_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
CREATE TABLE "enrollment_token" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrollment_token_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_token" ADD CONSTRAINT "enrollment_token_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_token" ADD CONSTRAINT "enrollment_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_token" ADD CONSTRAINT "enrollment_token_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "passkey_user_id_index" ON "passkey" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "enrollment_token_account_id_index" ON "enrollment_token" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "enrollment_token_user_id_index" ON "enrollment_token" USING btree ("user_id");--> statement-breakpoint

-- passkey는 사용자 자격 증명이라 계정 경계가 없다(사용자 한 명이 여러 계정에 속할 수 있다). RLS를 걸지 않고
-- 인증 역할(fmerp_auth)만 읽고 쓴다. 앱 역할은 직접 접근하지 않는다 (session·user_identity와 같은 방식).
GRANT SELECT, INSERT, UPDATE, DELETE ON "passkey" TO fmerp_auth;
--> statement-breakpoint

-- 등록 토큰은 계정 데이터다. 관리자가 앱 역할로 발급하고(RLS), 로그인 전 사용자가 토큰으로 조회·사용하므로
-- 인증 역할이 확인·사용 처리를 한다 (invitation과 같은 방식). 토큰 삭제 경로는 두지 않는다.
GRANT SELECT, INSERT, UPDATE ON "enrollment_token" TO fmerp_app;
GRANT SELECT, UPDATE ON "enrollment_token" TO fmerp_auth;
--> statement-breakpoint
ALTER TABLE "enrollment_token" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "enrollment_token" TO fmerp_app
  USING (account_id = app_current_account()) WITH CHECK (account_id = app_current_account());
