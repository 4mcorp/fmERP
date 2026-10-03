// 문서 검색 (PRD APV-082): 제목·문서번호·본문·첨부 파일명 글자 검색과 기안자·부서·양식·기간·상태·금액 조건.
// 결과는 열람 권한으로 거른다 (PERM-003). 부분 일치는 pg_trgm GIN 인덱스를 쓴다.

import type { Actor } from "@fmerp/core";
import { schema } from "@fmerp/db";
import { type SQL, sql } from "drizzle-orm";
import type { ServiceContext } from "./context";
import { type MailboxPage, pageDocuments, viewableCondition } from "./mailbox";

export interface SearchInput {
  q?: string;
  drafter?: string;
  departmentId?: string;
  formId?: string;
  statuses?: string[];
  /** 상신일 범위 (KST 날짜, 양끝 포함) */
  from?: string;
  to?: string;
  minAmount?: number;
  maxAmount?: number;
  limit?: number;
  cursor?: string;
}

const D = schema.document;

/** LIKE 와일드카드를 글자 그대로 찾도록 이스케이프한다 */
const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function searchDocuments(
  ctx: ServiceContext,
  viewer: { membershipId: string; actor: Actor },
  input: SearchInput,
): Promise<MailboxPage> {
  const where: (SQL | undefined)[] = [await viewableCondition(ctx, viewer)];

  const q = input.q?.trim();
  if (q) {
    const like = `%${escapeLike(q)}%`;
    // 3글자 미만은 trigram 인덱스를 쓸 수 없어 제목·문서번호의 앞부분 일치만 한다
    if (q.length < 3) {
      const prefix = `${escapeLike(q)}%`;
      where.push(sql`(${D.title} ilike ${prefix} or ${D.docNo} ilike ${prefix})`);
    } else {
      where.push(sql`(
        ${D.title} ilike ${like}
        or ${D.docNo} ilike ${like}
        or exists (select 1 from document_search ds where ds.document_id = ${D.id} and ds.body ilike ${like})
        or exists (select 1 from attachment at where at.document_id = ${D.id} and at.filename ilike ${like})
      )`);
    }
  }
  if (input.drafter?.trim()) {
    where.push(sql`${schema.user.name} ilike ${`%${escapeLike(input.drafter.trim())}%`}`);
  }
  if (input.departmentId) {
    // 기안자가 그 부서(하위 부서 포함)에 소속된 문서
    where.push(sql`exists (select 1 from assignment sa join department sd on sd.id = sa.department_id
      where sa.membership_id = ${D.drafterMembershipId} and sa.valid_to is null
        and (sd.id = ${input.departmentId}::uuid or sd.path like ${`%${input.departmentId}%`}))`);
  }
  if (input.formId) {
    where.push(sql`exists (select 1 from form_version fv where fv.id = ${D.formVersionId}
      and fv.form_id = ${input.formId}::uuid)`);
  }
  if (input.statuses && input.statuses.length > 0) {
    where.push(
      sql`${D.status} in (${sql.join(
        input.statuses.map((s) => sql`${s}`),
        sql`, `,
      )})`,
    );
  }
  if (input.from)
    where.push(sql`${D.submittedAt} >= (${input.from}::date)::timestamp at time zone 'Asia/Seoul'`);
  if (input.to) {
    where.push(
      sql`${D.submittedAt} < ((${input.to}::date) + 1)::timestamp at time zone 'Asia/Seoul'`,
    );
  }
  if (input.minAmount !== undefined) where.push(sql`${D.amount} >= ${input.minAmount}`);
  if (input.maxAmount !== undefined) where.push(sql`${D.amount} <= ${input.maxAmount}`);

  return pageDocuments(ctx, where, { limit: input.limit, cursor: input.cursor });
}
