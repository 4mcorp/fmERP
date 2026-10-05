CREATE TABLE "event_notified" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"recipient_membership_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"document_id" uuid,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"dedupe_key" text NOT NULL,
	"read_at" timestamp with time zone,
	"telegram_status" text DEFAULT 'NONE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_link" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"chat_id" bigint NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_link_token" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_notified" ADD CONSTRAINT "event_notified_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_recipient_membership_id_account_id_membership_id_account_id_fk" FOREIGN KEY ("recipient_membership_id","account_id") REFERENCES "public"."membership"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_link" ADD CONSTRAINT "telegram_link_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_link_token" ADD CONSTRAINT "telegram_link_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_recipient_membership_id_dedupe_key_index" ON "notification" USING btree ("recipient_membership_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "notification_recipient_membership_id_read_at_created_at_index" ON "notification" USING btree ("recipient_membership_id","read_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_link_chat_id_index" ON "telegram_link" USING btree ("chat_id");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_link_token_token_hash_index" ON "telegram_link_token" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "telegram_link_token_user_id_index" ON "telegram_link_token" USING btree ("user_id");