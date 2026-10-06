import { type Executor, schema } from "@fmerp/db";
import { eq } from "drizzle-orm";
import { DEFAULT_FORMS } from "../domain/form-defaults";

/**
 * 기본 양식 7종을 계정에 등록한다 (PRD APV-003). 이미 있는 코드는 건너뛰어 여러 번 실행해도 같은 결과가 된다.
 * 계정을 만들 때와 시드·보정 스크립트에서 쓴다. 호출자는 같은 계정의 테넌트 문맥(또는 RLS를 우회하는 연결)에서 부른다.
 */
export async function installDefaultForms(db: Executor, accountId: string): Promise<number> {
  const existing = await db
    .select({ code: schema.form.code })
    .from(schema.form)
    .where(eq(schema.form.accountId, accountId));
  const have = new Set(existing.map((f) => f.code));
  let created = 0;
  for (const f of DEFAULT_FORMS) {
    if (have.has(f.code)) continue;
    const [form] = await db
      .insert(schema.form)
      .values({ accountId, code: f.code, name: f.name, category: f.category })
      .returning({ id: schema.form.id });
    if (!form) continue;
    await db.insert(schema.formVersion).values({
      accountId,
      formId: form.id,
      version: 1,
      schema: f.schema as unknown as Record<string, unknown>,
      defaultLine: f.defaultLine as unknown as Record<string, unknown>[],
      numbering: f.numbering,
      retentionYears: f.retentionYears,
      securityDefault: f.securityDefault,
      allowLineEdit: f.allowLineEdit,
      policy: f.policy as unknown as Record<string, unknown>,
    });
    created += 1;
  }
  return created;
}
