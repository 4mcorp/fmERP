CREATE TABLE "backup_job" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"type" text DEFAULT 'account_export' NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"requested_by_membership_id" uuid NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"size" bigint,
	"sha256" text,
	"storage_key" text,
	"expires_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backup_job_ready" CHECK (("backup_job"."status" <> 'READY') or ("backup_job"."size" is not null and "backup_job"."sha256" is not null and "backup_job"."storage_key" is not null and "backup_job"."expires_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "system_backup" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"requested_by_user_id" uuid,
	"note" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"size" bigint,
	"sha256" text,
	"storage_key" text,
	"change_token" text,
	"pg_dump_version" text,
	"error" text,
	"delete_requested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_backup_done" CHECK (("system_backup"."status" <> 'SUCCEEDED') or ("system_backup"."size" is not null and "system_backup"."sha256" is not null and "system_backup"."storage_key" is not null))
);
--> statement-breakpoint
ALTER TABLE "backup_job" ADD CONSTRAINT "backup_job_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_job" ADD CONSTRAINT "backup_job_requested_by_membership_id_account_id_membership_id_account_id_fk" FOREIGN KEY ("requested_by_membership_id","account_id") REFERENCES "public"."membership"("id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "backup_job_single_active" ON "backup_job" USING btree ("account_id") WHERE "backup_job"."status" in ('QUEUED', 'RUNNING');--> statement-breakpoint
CREATE INDEX "backup_job_account_id_created_at_index" ON "backup_job" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "backup_job_status_created_at_index" ON "backup_job" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "system_backup_requested_at_index" ON "system_backup" USING btree ("requested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "system_backup_single_active" ON "system_backup" USING btree ((1)) WHERE "system_backup"."status" in ('QUEUED', 'RUNNING');