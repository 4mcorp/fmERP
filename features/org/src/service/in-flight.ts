// 진행 중인 결재가 있는지 확인하는 지점 (PRD ORG-005·015·036).
// 진행 중 = 상신되어 아직 끝나지 않은 문서(진행·보류). 결재선 단계가 남아 있는 사람·부서만 대상이다.
import type { Tx } from "@fmerp/db";
import { schema } from "@fmerp/db";
import { sql } from "drizzle-orm";

const IN_FLIGHT_STATUSES = sql`('IN_PROGRESS', 'ON_HOLD')`;
const OPEN_STEP_STATUSES = sql`('PENDING', 'ACTIVE', 'HELD')`;

async function count(tx: Tx, query: ReturnType<typeof sql>): Promise<number> {
  const { rows } = await tx.execute<{ n: string }>(query);
  return Number(rows[0]?.n ?? 0);
}

/** 사업자의 진행 중 문서 수 (ORG-005) */
export function countInFlightForBusiness(tx: Tx, businessId: string): Promise<number> {
  return count(
    tx,
    sql`select count(*) as n from ${schema.document}
        where business_id = ${businessId}::uuid and status in ${IN_FLIGHT_STATUSES}`,
  );
}

/** 부서(하위 부서 포함)에 소속된 사람이 처리 전 단계에 걸려 있는 진행 중 문서 수 (ORG-015) */
export function countInFlightForDepartment(tx: Tx, departmentId: string): Promise<number> {
  return count(
    tx,
    sql`select count(distinct d.id) as n
        from ${schema.document} d
        join ${schema.approvalStep} s on s.document_id = d.id
        join ${schema.assignment} a on a.membership_id = any (s.assignee_ids) and a.valid_to is null
        join ${schema.department} dp on dp.id = a.department_id
        where d.status in ${IN_FLIGHT_STATUSES} and s.status in ${OPEN_STEP_STATUSES}
          and (dp.id = ${departmentId}::uuid or dp.path like ${`%${departmentId}%`})`,
  );
}

/**
 * 구성원이 처리자로 처리 전 단계에 걸려 있는 진행 중 문서 수 (ORG-036). 대결자는 세지 않는다:
 * 원 결재자가 계속 처리할 수 있고, 이관(transferAssignments)도 처리자만 바꾼다.
 */
export function countInFlightForMember(tx: Tx, membershipId: string): Promise<number> {
  return count(
    tx,
    sql`select count(distinct d.id) as n
        from ${schema.document} d
        join ${schema.approvalStep} s on s.document_id = d.id
        where d.status in ${IN_FLIGHT_STATUSES} and s.status in ${OPEN_STEP_STATUSES}
          and ${membershipId}::uuid = any (s.assignee_ids)`,
  );
}
