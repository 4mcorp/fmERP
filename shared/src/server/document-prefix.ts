// 문서의 S3 키 접두사: 계정·사업자 코드·작성 시각·문서 id (결재 본문·첨부와 완료 패키지가 같은 규칙을 쓴다)
import { schema } from "@fmerp/db";
import { docPrefix } from "@fmerp/storage";
import { eq } from "drizzle-orm";
import type { ServiceContext } from "./context";
import { ServiceError } from "./errors";

type DocRow = typeof schema.document.$inferSelect;

async function businessCodeOf(ctx: ServiceContext, businessId: string): Promise<string> {
  const [b] = await ctx.tx
    .select({ code: schema.business.code })
    .from(schema.business)
    .where(eq(schema.business.id, businessId));
  if (!b) throw new ServiceError("not_found", "사업자를 찾을 수 없습니다");
  return b.code;
}

export async function documentPrefix(ctx: ServiceContext, doc: DocRow): Promise<string> {
  return docPrefix(doc.accountId, await businessCodeOf(ctx, doc.businessId), doc.createdAt, doc.id);
}
