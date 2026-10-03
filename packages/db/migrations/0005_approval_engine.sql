CREATE TABLE "approval_action" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"step_id" uuid NOT NULL,
	"actor_membership_id" uuid NOT NULL,
	"on_behalf_of_membership_id" uuid,
	"action" text NOT NULL,
	"comment" text,
	"idempotency_key" text NOT NULL,
	"doc_hash" text,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_action_stepId_idempotencyKey_unique" UNIQUE("step_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "approval_event" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_step" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"assignee_ids" uuid[] NOT NULL,
	"assignee_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"delegates" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"can_finalize" boolean DEFAULT false NOT NULL,
	"quorum" integer,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"held_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_step_id_account_unique" UNIQUE("id","account_id"),
	CONSTRAINT "approval_step_assignees" CHECK (cardinality("approval_step"."assignee_ids") >= 1),
	CONSTRAINT "approval_step_quorum" CHECK ("approval_step"."quorum" is null or "approval_step"."quorum" >= 1)
);
--> statement-breakpoint
CREATE TABLE "delegation" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"delegate_membership_id" uuid NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone NOT NULL,
	"scope" jsonb DEFAULT '{"kind":"all"}'::jsonb NOT NULL,
	"reason" text,
	"created_by" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delegation_period" CHECK ("delegation"."valid_from" < "delegation"."valid_to"),
	CONSTRAINT "delegation_not_self" CHECK ("delegation"."membership_id" <> "delegation"."delegate_membership_id")
);
--> statement-breakpoint
CREATE TABLE "doc_number_series" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"key" text NOT NULL,
	"last_seq" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doc_number_series_businessId_key_unique" UNIQUE("business_id","key")
);
--> statement-breakpoint
CREATE TABLE "document" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"drafter_membership_id" uuid NOT NULL,
	"drafter_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"title" text NOT NULL,
	"body" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"policy" jsonb NOT NULL,
	"numbering" jsonb,
	"doc_no" text,
	"form_category" text,
	"source_type" text,
	"source_id" text,
	"supersedes" uuid,
	"content_hash" text,
	"submitted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_id_account_unique" UNIQUE("id","account_id")
);
--> statement-breakpoint
ALTER TABLE "approval_action" ADD CONSTRAINT "approval_action_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_action" ADD CONSTRAINT "approval_action_step_id_account_id_approval_step_id_account_id_fk" FOREIGN KEY ("step_id","account_id") REFERENCES "public"."approval_step"("id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_action" ADD CONSTRAINT "approval_action_actor_membership_id_account_id_membership_id_account_id_fk" FOREIGN KEY ("actor_membership_id","account_id") REFERENCES "public"."membership"("id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_event" ADD CONSTRAINT "approval_event_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_step" ADD CONSTRAINT "approval_step_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_step" ADD CONSTRAINT "approval_step_document_id_account_id_document_id_account_id_fk" FOREIGN KEY ("document_id","account_id") REFERENCES "public"."document"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegation" ADD CONSTRAINT "delegation_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegation" ADD CONSTRAINT "delegation_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegation" ADD CONSTRAINT "delegation_membership_id_account_id_membership_id_account_id_fk" FOREIGN KEY ("membership_id","account_id") REFERENCES "public"."membership"("id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegation" ADD CONSTRAINT "delegation_delegate_membership_id_account_id_membership_id_account_id_fk" FOREIGN KEY ("delegate_membership_id","account_id") REFERENCES "public"."membership"("id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_number_series" ADD CONSTRAINT "doc_number_series_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_number_series" ADD CONSTRAINT "doc_number_series_business_id_account_id_business_id_account_id_fk" FOREIGN KEY ("business_id","account_id") REFERENCES "public"."business"("id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_business_id_account_id_business_id_account_id_fk" FOREIGN KEY ("business_id","account_id") REFERENCES "public"."business"("id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_drafter_membership_id_account_id_membership_id_account_id_fk" FOREIGN KEY ("drafter_membership_id","account_id") REFERENCES "public"."membership"("id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_supersedes_document_id_fk" FOREIGN KEY ("supersedes") REFERENCES "public"."document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_action_document_id_index" ON "approval_action" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "approval_event_document_id_index" ON "approval_event" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "approval_event_created_at_index" ON "approval_event" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "approval_step_document_id_seq_index" ON "approval_step" USING btree ("document_id","seq");--> statement-breakpoint
CREATE INDEX "delegation_membership_id_index" ON "delegation" USING btree ("membership_id");--> statement-breakpoint
CREATE INDEX "document_status_index" ON "document" USING btree ("status");--> statement-breakpoint
CREATE INDEX "document_drafter_membership_id_index" ON "document" USING btree ("drafter_membership_id");--> statement-breakpoint
CREATE INDEX "document_source_type_source_id_index" ON "document" USING btree ("source_type","source_id");