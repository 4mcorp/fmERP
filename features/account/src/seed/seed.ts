import { type Db, schema } from "@fmerp/db";
import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { DEV_TEST_PASSWORD, TEST_ACCOUNTS, TEST_USERS } from "../service/test-accounts";

/**
 * 개발·테스트용 계정을 만든다. 여러 번 실행해도 같은 결과가 되도록(멱등) 이메일·slug 기준으로 확인한다.
 * Better Auth의 이메일 로그인은 user_identity(providerId=credential)의 비밀번호 해시를 쓴다.
 */
export async function seedTestAccounts(db: Db): Promise<{ users: number; accounts: number }> {
  const passwordHash = await hashPassword(DEV_TEST_PASSWORD);

  const accountIds = new Map<string, string>();
  for (const [key, def] of Object.entries(TEST_ACCOUNTS)) {
    const [row] = await db
      .insert(schema.account)
      .values({ name: def.name, slug: def.slug })
      .onConflictDoUpdate({ target: schema.account.slug, set: { name: def.name } })
      .returning({ id: schema.account.id });
    if (row) accountIds.set(key, row.id);
  }

  for (const def of TEST_USERS) {
    const [user] = await db
      .insert(schema.user)
      .values({ email: def.email, name: def.name, emailVerified: true })
      .onConflictDoUpdate({ target: schema.user.email, set: { name: def.name } })
      .returning({ id: schema.user.id });
    if (!user) continue;

    const [identity] = await db
      .select({ id: schema.userIdentity.id })
      .from(schema.userIdentity)
      .where(
        and(
          eq(schema.userIdentity.userId, user.id),
          eq(schema.userIdentity.providerId, "credential"),
        ),
      );
    if (identity) {
      await db
        .update(schema.userIdentity)
        .set({ password: passwordHash })
        .where(eq(schema.userIdentity.id, identity.id));
    } else {
      await db.insert(schema.userIdentity).values({
        userId: user.id,
        providerId: "credential",
        providerAccountId: user.id,
        password: passwordHash,
      });
    }

    for (const m of def.memberships) {
      const accountId = accountIds.get(m.account);
      if (!accountId) continue;
      const status = m.status ?? "active";
      await db
        .insert(schema.membership)
        .values({
          accountId,
          userId: user.id,
          role: m.role,
          status,
          leftAt: status === "left" ? new Date() : null,
        })
        .onConflictDoUpdate({
          target: [schema.membership.accountId, schema.membership.userId],
          set: { role: m.role, status, leftAt: status === "left" ? new Date() : null },
        });
    }
  }

  return { users: TEST_USERS.length, accounts: accountIds.size };
}
