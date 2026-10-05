CREATE TABLE "audit_review" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"period" text NOT NULL,
	"reviewer_membership_id" uuid NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"memo" text,
	"abnormal" boolean DEFAULT false NOT NULL,
	"abnormal_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_review_period" CHECK ("audit_review"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "audit_review_abnormal_note" CHECK (not "audit_review"."abnormal" or length(btrim(coalesce("audit_review"."abnormal_note", ''))) > 0)
);
--> statement-breakpoint
ALTER TABLE "audit_review" ADD CONSTRAINT "audit_review_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_review" ADD CONSTRAINT "audit_review_reviewer_membership_id_account_id_membership_id_account_id_fk" FOREIGN KEY ("reviewer_membership_id","account_id") REFERENCES "public"."membership"("id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_review_account_id_period_reviewed_at_index" ON "audit_review" USING btree ("account_id","period","reviewed_at");