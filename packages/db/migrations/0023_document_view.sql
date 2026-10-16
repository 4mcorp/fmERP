-- feature: approval
-- 결재 문서 열람 기록 (R8 읽음 표시, docs/plan/2026-10-15-ui-ux-refactor-round2.md 4장). 감사 로그가 아니다. forward-only

CREATE TABLE "document_view" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"first_viewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_viewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_view_documentId_membershipId_unique" UNIQUE("document_id","membership_id")
);
--> statement-breakpoint
ALTER TABLE "document_view" ADD CONSTRAINT "document_view_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_view" ADD CONSTRAINT "document_view_document_id_account_id_document_id_account_id_fk" FOREIGN KEY ("document_id","account_id") REFERENCES "public"."document"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_view" ADD CONSTRAINT "document_view_membership_id_account_id_membership_id_account_id_fk" FOREIGN KEY ("membership_id","account_id") REFERENCES "public"."membership"("id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_view_membership_id_index" ON "document_view" USING btree ("membership_id");--> statement-breakpoint

-- 열람 기록은 만들고 갱신만 한다. 삭제는 없다 (계정 삭제 시 cascade)
GRANT SELECT, INSERT, UPDATE ON "document_view" TO fmerp_app;
--> statement-breakpoint
ALTER TABLE "document_view" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "document_view" TO fmerp_app
  USING (account_id = app_current_account()) WITH CHECK (account_id = app_current_account());
