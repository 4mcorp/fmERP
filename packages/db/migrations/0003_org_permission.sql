CREATE TABLE "assignment" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"position_id" uuid,
	"duty_id" uuid,
	"is_primary" boolean DEFAULT false NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignment_history" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"assignment_id" uuid,
	"action" text NOT NULL,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"effective_date" date NOT NULL,
	"reason" text,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"biz_reg_no" text NOT NULL,
	"corp_reg_no" text,
	"ceo_name" text,
	"industry" text,
	"address" text,
	"phone" text,
	"code" text NOT NULL,
	"seal_key" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_accountId_bizRegNo_unique" UNIQUE("account_id","biz_reg_no"),
	CONSTRAINT "business_accountId_code_unique" UNIQUE("account_id","code"),
	CONSTRAINT "business_id_account_unique" UNIQUE("id","account_id")
);
--> statement-breakpoint
CREATE TABLE "department" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"parent_id" uuid,
	"depth" integer DEFAULT 1 NOT NULL,
	"path" text DEFAULT '' NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"short_name" text,
	"head_membership_id" uuid,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"valid_from" date,
	"valid_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "department_businessId_code_unique" UNIQUE("business_id","code"),
	CONSTRAINT "department_id_account_unique" UNIQUE("id","account_id"),
	CONSTRAINT "department_depth_range" CHECK ("department"."depth" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "duty" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "duty_accountId_name_unique" UNIQUE("account_id","name"),
	CONSTRAINT "duty_id_account_unique" UNIQUE("id","account_id")
);
--> statement-breakpoint
CREATE TABLE "position" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"rank" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "position_accountId_name_unique" UNIQUE("account_id","name"),
	CONSTRAINT "position_id_account_unique" UNIQUE("id","account_id")
);
--> statement-breakpoint
CREATE TABLE "role_grant" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"role" text NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_grant_scope_id" CHECK (("role_grant"."scope_type" = 'account') = ("role_grant"."scope_id" is null))
);
--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "max_dept_depth" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "allowed_domains" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "timezone" text DEFAULT 'Asia/Seoul' NOT NULL;--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "locale" text DEFAULT 'ko' NOT NULL;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_id_account_unique" UNIQUE("id","account_id");--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_accountId_employeeNo_unique" UNIQUE("account_id","employee_no");--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_max_dept_depth_range" CHECK ("account"."max_dept_depth" between 1 and 5);--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_membership_id_account_id_membership_id_account_id_fk" FOREIGN KEY ("membership_id","account_id") REFERENCES "public"."membership"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_business_id_account_id_business_id_account_id_fk" FOREIGN KEY ("business_id","account_id") REFERENCES "public"."business"("id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_department_id_account_id_department_id_account_id_fk" FOREIGN KEY ("department_id","account_id") REFERENCES "public"."department"("id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_position_id_account_id_position_id_account_id_fk" FOREIGN KEY ("position_id","account_id") REFERENCES "public"."position"("id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_duty_id_account_id_duty_id_account_id_fk" FOREIGN KEY ("duty_id","account_id") REFERENCES "public"."duty"("id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_history" ADD CONSTRAINT "assignment_history_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_history" ADD CONSTRAINT "assignment_history_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_history" ADD CONSTRAINT "assignment_history_membership_id_account_id_membership_id_account_id_fk" FOREIGN KEY ("membership_id","account_id") REFERENCES "public"."membership"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business" ADD CONSTRAINT "business_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department" ADD CONSTRAINT "department_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department" ADD CONSTRAINT "department_business_id_account_id_business_id_account_id_fk" FOREIGN KEY ("business_id","account_id") REFERENCES "public"."business"("id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department" ADD CONSTRAINT "department_head_membership_id_account_id_membership_id_account_id_fk" FOREIGN KEY ("head_membership_id","account_id") REFERENCES "public"."membership"("id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department" ADD CONSTRAINT "department_parent_id_department_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."department"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duty" ADD CONSTRAINT "duty_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position" ADD CONSTRAINT "position_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_grant" ADD CONSTRAINT "role_grant_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_grant" ADD CONSTRAINT "role_grant_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_grant" ADD CONSTRAINT "role_grant_membership_id_account_id_membership_id_account_id_fk" FOREIGN KEY ("membership_id","account_id") REFERENCES "public"."membership"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assignment_one_primary" ON "assignment" USING btree ("membership_id") WHERE "assignment"."is_primary" and "assignment"."valid_to" is null;--> statement-breakpoint
CREATE INDEX "assignment_membership_id_index" ON "assignment" USING btree ("membership_id");--> statement-breakpoint
CREATE INDEX "assignment_department_id_index" ON "assignment" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "assignment_history_membership_id_index" ON "assignment_history" USING btree ("membership_id");--> statement-breakpoint
CREATE INDEX "department_business_id_index" ON "department" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "department_parent_id_index" ON "department" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "department_path_index" ON "department" USING btree ("path");--> statement-breakpoint
CREATE UNIQUE INDEX "role_grant_unique" ON "role_grant" USING btree ("membership_id","role","scope_type",coalesce("scope_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE INDEX "role_grant_membership_id_index" ON "role_grant" USING btree ("membership_id");
