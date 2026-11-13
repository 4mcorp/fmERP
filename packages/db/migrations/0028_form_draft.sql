-- feature: approval
CREATE TABLE "form_draft" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"author_membership_id" uuid NOT NULL,
	"schema" jsonb NOT NULL,
	"layout" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "form_draft_formId_authorMembershipId_unique" UNIQUE("form_id","author_membership_id"),
	CONSTRAINT "form_draft_revision_positive" CHECK ("form_draft"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "form_draft" ADD CONSTRAINT "form_draft_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_draft" ADD CONSTRAINT "form_draft_form_id_account_id_form_id_account_id_fk" FOREIGN KEY ("form_id","account_id") REFERENCES "public"."form"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_draft" ADD CONSTRAINT "form_draft_author_membership_id_account_id_membership_id_account_id_fk" FOREIGN KEY ("author_membership_id","account_id") REFERENCES "public"."membership"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "form_draft_account_id_index" ON "form_draft" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "form_draft_author_membership_id_index" ON "form_draft" USING btree ("author_membership_id");
--> statement-breakpoint
ALTER TABLE "form_draft" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "form_draft" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "form_draft" TO fmerp_app
  USING (account_id = app_current_account())
  WITH CHECK (account_id = app_current_account());
REVOKE ALL ON "form_draft" FROM fmerp_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON "form_draft" TO fmerp_app;