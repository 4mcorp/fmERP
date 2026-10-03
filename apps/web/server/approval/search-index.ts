import { extractSearchIndex, type FormSchema } from "@fmerp/core";
import { schema } from "@fmerp/db";
import type { ServiceContext } from "./context";
import { getFormVersion } from "./forms";

/**
 * 상신할 때 본문 텍스트를 검색 색인(document_search)에 저장하고 금액 검색 값을 돌려준다 (APV-082, ADR 0009).
 * 본문은 S3에만 있어 검색을 위해 상신 시점에 복사한다. 회수 후 다시 상신하면 덮어쓴다.
 * 양식 없이 만든 문서(ERP 모듈 연동)는 본문 스키마가 없어 색인하지 않는다.
 */
export async function indexSubmitted(
  ctx: ServiceContext,
  doc: { id: string; formVersionId: string | null },
  values: Record<string, unknown>,
): Promise<number | null> {
  if (!doc.formVersionId) return null;
  const version = await getFormVersion(ctx.tx, doc.formVersionId);
  const { text, amount } = extractSearchIndex(version.schema as unknown as FormSchema, values);
  await ctx.tx
    .insert(schema.documentSearch)
    .values({ documentId: doc.id, accountId: ctx.accountId, body: text })
    .onConflictDoUpdate({
      target: schema.documentSearch.documentId,
      set: { body: text, updatedAt: ctx.now },
    });
  return amount;
}
