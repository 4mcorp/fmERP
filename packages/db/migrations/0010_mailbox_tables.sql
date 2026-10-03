CREATE TABLE "document_distribution" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"distributed_by_membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_distribution_recipientId_membershipId_unique" UNIQUE("recipient_id","membership_id")
);
--> statement-breakpoint
CREATE TABLE "document_package" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"manifest_hash" text,
	"ready_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_package_ready" CHECK (("document_package"."status" = 'READY') = ("document_package"."manifest_hash" is not null and "document_package"."ready_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "document_recipient" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"target_membership_id" uuid,
	"target_department_id" uuid,
	"assignee_membership_id" uuid,
	"received_by_membership_id" uuid,
	"received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_recipient_id_account_unique" UNIQUE("id","account_id"),
	CONSTRAINT "document_recipient_target" CHECK (("document_recipient"."target_membership_id" is null) <> ("document_recipient"."target_department_id" is null)),
	CONSTRAINT "document_recipient_receive_department" CHECK ("document_recipient"."kind" <> 'receive' or "document_recipient"."target_department_id" is not null),
	CONSTRAINT "document_recipient_received" CHECK (("document_recipient"."received_by_membership_id" is null) = ("document_recipient"."received_at" is null))
);
--> statement-breakpoint
CREATE TABLE "document_recipient_read" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_recipient_read_recipientId_membershipId_unique" UNIQUE("recipient_id","membership_id")
);
--> statement-breakpoint
CREATE TABLE "document_search" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"body" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "amount" bigint;--> statement-breakpoint
ALTER TABLE "document_distribution" ADD CONSTRAINT "document_distribution_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_distribution" ADD CONSTRAINT "document_distribution_recipient_id_account_id_document_recipient_id_account_id_fk" FOREIGN KEY ("recipient_id","account_id") REFERENCES "public"."document_recipient"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_distribution" ADD CONSTRAINT "document_distribution_membership_id_account_id_membership_id_account_id_fk" FOREIGN KEY ("membership_id","account_id") REFERENCES "public"."membership"("id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_distribution" ADD CONSTRAINT "document_distribution_distributed_by_membership_id_account_id_membership_id_account_id_fk" FOREIGN KEY ("distributed_by_membership_id","account_id") REFERENCES "public"."membership"("id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_package" ADD CONSTRAINT "document_package_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_package" ADD CONSTRAINT "document_package_document_id_account_id_document_id_account_id_fk" FOREIGN KEY ("document_id","account_id") REFERENCES "public"."document"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_recipient" ADD CONSTRAINT "document_recipient_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_recipient" ADD CONSTRAINT "document_recipient_document_id_account_id_document_id_account_id_fk" FOREIGN KEY ("document_id","account_id") REFERENCES "public"."document"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_recipient" ADD CONSTRAINT "document_recipient_target_membership_id_account_id_membership_id_account_id_fk" FOREIGN KEY ("target_membership_id","account_id") REFERENCES "public"."membership"("id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_recipient" ADD CONSTRAINT "document_recipient_target_department_id_account_id_department_id_account_id_fk" FOREIGN KEY ("target_department_id","account_id") REFERENCES "public"."department"("id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_recipient" ADD CONSTRAINT "document_recipient_assignee_membership_id_account_id_membership_id_account_id_fk" FOREIGN KEY ("assignee_membership_id","account_id") REFERENCES "public"."membership"("id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_recipient" ADD CONSTRAINT "document_recipient_received_by_membership_id_account_id_membership_id_account_id_fk" FOREIGN KEY ("received_by_membership_id","account_id") REFERENCES "public"."membership"("id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_recipient_read" ADD CONSTRAINT "document_recipient_read_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_recipient_read" ADD CONSTRAINT "document_recipient_read_recipient_id_account_id_document_recipient_id_account_id_fk" FOREIGN KEY ("recipient_id","account_id") REFERENCES "public"."document_recipient"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_recipient_read" ADD CONSTRAINT "document_recipient_read_membership_id_account_id_membership_id_account_id_fk" FOREIGN KEY ("membership_id","account_id") REFERENCES "public"."membership"("id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_search" ADD CONSTRAINT "document_search_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_search" ADD CONSTRAINT "document_search_document_id_account_id_document_id_account_id_fk" FOREIGN KEY ("document_id","account_id") REFERENCES "public"."document"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_distribution_membership_id_index" ON "document_distribution" USING btree ("membership_id");--> statement-breakpoint
CREATE INDEX "document_package_status_updated_at_index" ON "document_package" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "document_recipient_document_id_index" ON "document_recipient" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_recipient_target_membership_id_kind_index" ON "document_recipient" USING btree ("target_membership_id","kind");--> statement-breakpoint
CREATE INDEX "document_recipient_target_department_id_kind_index" ON "document_recipient" USING btree ("target_department_id","kind");