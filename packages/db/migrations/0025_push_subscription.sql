-- feature: notification
-- 웹 푸시 구독 (PWA 홈 화면 앱·브라우저의 기기별 구독). 계정 소속이라 RLS 격리를 받는다 (PWA·Web Push 카드)
CREATE TABLE "push_subscription" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_membership_id_account_id_membership_id_account_id_fk" FOREIGN KEY ("membership_id","account_id") REFERENCES "public"."membership"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscription_endpoint_index" ON "push_subscription" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "push_subscription_membership_id_index" ON "push_subscription" USING btree ("membership_id");
--> statement-breakpoint
-- 앱은 구독을 만들고(같은 기기 재등록은 갱신), 해제·만료 정리로 지운다
GRANT SELECT, INSERT, UPDATE, DELETE ON "push_subscription" TO fmerp_app;
--> statement-breakpoint
ALTER TABLE "push_subscription" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "push_subscription" TO fmerp_app
  USING (account_id = app_current_account()) WITH CHECK (account_id = app_current_account());
