CREATE TABLE "approval_comment" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"step_id" uuid,
	"author_membership_id" uuid NOT NULL,
	"body" text NOT NULL,
	"visibility" text DEFAULT 'all' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_line_template" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"form_id" uuid,
	"owner_membership_id" uuid,
	"name" text NOT NULL,
	"items" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachment" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"size" bigint NOT NULL,
	"mime" text NOT NULL,
	"sha256" text NOT NULL,
	"uploaded_by_membership_id" uuid NOT NULL,
	"scan_status" text DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_link" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"linked_document_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_link_documentId_linkedDocumentId_unique" UNIQUE("document_id","linked_document_id")
);
--> statement-breakpoint
CREATE TABLE "document_revision" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"n" integer NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"size" integer NOT NULL,
	"saved_by_membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_revision_documentId_n_unique" UNIQUE("document_id","n")
);
--> statement-breakpoint
CREATE TABLE "form" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT '일반' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "form_accountId_code_unique" UNIQUE("account_id","code"),
	CONSTRAINT "form_id_account_unique" UNIQUE("id","account_id")
);
--> statement-breakpoint
CREATE TABLE "form_version" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"schema" jsonb NOT NULL,
	"layout" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"default_line" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"numbering" jsonb,
	"retention_years" integer DEFAULT 3 NOT NULL,
	"security_default" text DEFAULT 'normal' NOT NULL,
	"recipients" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"allow_line_edit" boolean DEFAULT true NOT NULL,
	"policy" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "form_version_formId_version_unique" UNIQUE("form_id","version"),
	CONSTRAINT "form_version_id_account_unique" UNIQUE("id","account_id")
);
--> statement-breakpoint
CREATE TABLE "user_form_pref" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"favorite" boolean DEFAULT false NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "user_form_pref_membershipId_formId_unique" UNIQUE("membership_id","form_id")
);
--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "form_version_id" uuid;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "security_level" text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "urgent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "desired_due_date" date;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "latest_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_comment" ADD CONSTRAINT "approval_comment_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_comment" ADD CONSTRAINT "approval_comment_document_id_account_id_document_id_account_id_fk" FOREIGN KEY ("document_id","account_id") REFERENCES "public"."document"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_comment" ADD CONSTRAINT "approval_comment_author_membership_id_account_id_membership_id_account_id_fk" FOREIGN KEY ("author_membership_id","account_id") REFERENCES "public"."membership"("id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_line_template" ADD CONSTRAINT "approval_line_template_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_line_template" ADD CONSTRAINT "approval_line_template_form_id_account_id_form_id_account_id_fk" FOREIGN KEY ("form_id","account_id") REFERENCES "public"."form"("id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_line_template" ADD CONSTRAINT "approval_line_template_owner_membership_id_account_id_membership_id_account_id_fk" FOREIGN KEY ("owner_membership_id","account_id") REFERENCES "public"."membership"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_document_id_account_id_document_id_account_id_fk" FOREIGN KEY ("document_id","account_id") REFERENCES "public"."document"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_uploaded_by_membership_id_account_id_membership_id_account_id_fk" FOREIGN KEY ("uploaded_by_membership_id","account_id") REFERENCES "public"."membership"("id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_link" ADD CONSTRAINT "document_link_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_link" ADD CONSTRAINT "document_link_document_id_account_id_document_id_account_id_fk" FOREIGN KEY ("document_id","account_id") REFERENCES "public"."document"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_link" ADD CONSTRAINT "document_link_linked_document_id_account_id_document_id_account_id_fk" FOREIGN KEY ("linked_document_id","account_id") REFERENCES "public"."document"("id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_revision" ADD CONSTRAINT "document_revision_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_revision" ADD CONSTRAINT "document_revision_document_id_account_id_document_id_account_id_fk" FOREIGN KEY ("document_id","account_id") REFERENCES "public"."document"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_revision" ADD CONSTRAINT "document_revision_saved_by_membership_id_account_id_membership_id_account_id_fk" FOREIGN KEY ("saved_by_membership_id","account_id") REFERENCES "public"."membership"("id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form" ADD CONSTRAINT "form_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_version" ADD CONSTRAINT "form_version_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_version" ADD CONSTRAINT "form_version_form_id_account_id_form_id_account_id_fk" FOREIGN KEY ("form_id","account_id") REFERENCES "public"."form"("id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_form_pref" ADD CONSTRAINT "user_form_pref_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_form_pref" ADD CONSTRAINT "user_form_pref_membership_id_account_id_membership_id_account_id_fk" FOREIGN KEY ("membership_id","account_id") REFERENCES "public"."membership"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_form_pref" ADD CONSTRAINT "user_form_pref_form_id_account_id_form_id_account_id_fk" FOREIGN KEY ("form_id","account_id") REFERENCES "public"."form"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_comment_document_id_index" ON "approval_comment" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "approval_line_template_form_id_index" ON "approval_line_template" USING btree ("form_id");--> statement-breakpoint
CREATE INDEX "approval_line_template_owner_membership_id_index" ON "approval_line_template" USING btree ("owner_membership_id");--> statement-breakpoint
CREATE INDEX "attachment_document_id_index" ON "attachment" USING btree ("document_id");