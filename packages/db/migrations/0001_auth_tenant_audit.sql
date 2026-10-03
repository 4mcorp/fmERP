CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"on_behalf_of_user_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"target_label" text,
	"subject_user_id" uuid,
	"diff" jsonb,
	"ip" text,
	"user_agent" text,
	"request_id" text,
	"result" text NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "approval_pin" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"pin_hash" text NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"active_account_id" uuid,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	"pin_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"signature_key" text,
	"stamp_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "user_identity" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"metadata" text,
	"security_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"email" text,
	"preset" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_by" uuid,
	"revoked_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "membership" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"employee_no" text,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approval_pin" ADD CONSTRAINT "approval_pin_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_active_account_id_account_id_fk" FOREIGN KEY ("active_account_id") REFERENCES "public"."account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_identity" ADD CONSTRAINT "user_identity_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_used_by_user_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_account_id_occurred_at_index" ON "audit_log" USING btree ("account_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_user_id_occurred_at_index" ON "audit_log" USING btree ("actor_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "session_user_id_index" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_identity_provider_id_provider_account_id_index" ON "user_identity" USING btree ("provider_id","provider_account_id");--> statement-breakpoint
CREATE INDEX "user_identity_user_id_index" ON "user_identity" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_index" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "invitation_account_id_index" ON "invitation" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_account_id_user_id_index" ON "membership" USING btree ("account_id","user_id");--> statement-breakpoint
CREATE INDEX "membership_user_id_index" ON "membership" USING btree ("user_id");