// 구성원 이름·메일 변경. user 표는 인증 계정(fmerp_auth)만 쓸 수 있어 authDb로 한 트랜잭션에서 처리한다.
import { type AuditRequestContext, computeAuditDiff, recordAudit } from "@fmerp/audit";
import { type Db, schema } from "@fmerp/db";
import { ApiError } from "@fmerp/shared/server/http";
import { and, eq, ne } from "drizzle-orm";

export interface IdentityChange {
  accountId: string;
  membershipId: string;
  userId: string;
  actorId: string;
  name?: string;
  email?: string;
  request: AuditRequestContext;
}

export async function changeIdentity(authDb: Db, input: IdentityChange): Promise<void> {
  await authDb.transaction(async (tx) => {
    const [before] = await tx
      .select({ name: schema.user.name, email: schema.user.email })
      .from(schema.user)
      .where(eq(schema.user.id, input.userId))
      .for("update");
    if (!before) throw new ApiError(404, "not_found", "사용자를 찾을 수 없습니다");

    const after = { name: input.name ?? before.name, email: input.email ?? before.email };
    const changed = (["name", "email"] as const).filter((f) => after[f] !== before[f]);
    if (changed.length === 0) return;

    // 이름·메일은 계정 사이에서 공유되는 사용자 정보다. 다른 회사에도 속한 사람은 한 회사 관리자가 바꿀 수 없다
    const others = await tx
      .select({ id: schema.membership.id })
      .from(schema.membership)
      .where(
        and(
          eq(schema.membership.userId, input.userId),
          ne(schema.membership.accountId, input.accountId),
        ),
      )
      .limit(1);
    if (others.length > 0) {
      throw new ApiError(
        409,
        "shared_identity",
        "다른 회사에도 속한 사용자여서 이름·메일을 바꿀 수 없습니다",
      );
    }

    if (changed.includes("email")) {
      const [dup] = await tx
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(and(eq(schema.user.email, after.email), ne(schema.user.id, input.userId)));
      if (dup) throw new ApiError(409, "email_in_use", "이미 사용 중인 메일 주소입니다");
    }

    await tx
      .update(schema.user)
      .set({ name: after.name, email: after.email })
      .where(eq(schema.user.id, input.userId));
    await tx.insert(schema.memberIdentityHistory).values(
      changed.map((field) => ({
        accountId: input.accountId,
        membershipId: input.membershipId,
        field,
        oldValue: before[field],
        newValue: after[field],
        actorUserId: input.actorId,
      })),
    );
    await recordAudit(tx, {
      accountId: input.accountId,
      actorUserId: input.actorId,
      action: "member.identity_change",
      target: { type: "membership", id: input.userId },
      subjectUserId: input.userId,
      diff: computeAuditDiff(before, after),
      result: "success",
      request: input.request,
    });
  });
}
