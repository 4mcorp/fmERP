// 구성원·세션 기본기: API 보호 미들웨어(shared/server/http)와 구성원 관리가 함께 쓴다 (PRD AUTH-015)
import { type Db, type MembershipRole, schema } from "@fmerp/db";
import { and, eq } from "drizzle-orm";
import { AuthDomainError } from "./errors";

/** 활성 계정의 재직 중인 구성원인지 확인한다. 아니면 진입을 막는다 (PRD AUTH-015). */
export async function requireActiveMembership(db: Db, accountId: string, userId: string) {
  const [member] = await db
    .select({ role: schema.membership.role, status: schema.membership.status })
    .from(schema.membership)
    .where(and(eq(schema.membership.accountId, accountId), eq(schema.membership.userId, userId)));
  if (member?.status !== "active") {
    throw new AuthDomainError("membership_inactive", "이 회사에 접근할 수 없습니다");
  }
  return { role: member.role as MembershipRole };
}

/** 비활성화된 구성원이 그 계정으로 쓰던 세션을 종료한다 (PRD AUTH-015). */
export async function revokeSessionsInAccount(db: Db, userId: string, accountId: string) {
  const deleted = await db
    .delete(schema.session)
    .where(and(eq(schema.session.userId, userId), eq(schema.session.activeAccountId, accountId)))
    .returning({ id: schema.session.id });
  return deleted.length;
}
