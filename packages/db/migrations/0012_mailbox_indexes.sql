-- 감사함·수신함 등 계정 전체를 최근 만든 순으로 넘기는 문서함의 키셋 페이지네이션용 인덱스 (APV-080·081, NFR-P03)
CREATE INDEX "document_account_created_idx" ON "document" ("account_id", "created_at" DESC, "id" DESC) WHERE "status" <> 'DRAFT';
--> statement-breakpoint
CREATE INDEX "document_recipient_target_doc_idx" ON "document_recipient" ("target_department_id", "kind", "document_id");
