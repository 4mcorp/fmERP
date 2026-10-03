import type { OrgSnapshot } from "@fmerp/core";
import { schema, type Tx } from "@fmerp/db";
import { eq, isNull } from "drizzle-orm";

/** 결재선 해석에 쓸 조직 스냅샷을 현재 테넌트에서 읽는다 (RLS가 계정을 거른다) */
export async function loadOrgSnapshot(tx: Tx): Promise<OrgSnapshot> {
  const members = await tx
    .select({ membershipId: schema.membership.id, status: schema.membership.status })
    .from(schema.membership);
  const departments = await tx
    .select({
      id: schema.department.id,
      parentId: schema.department.parentId,
      businessId: schema.department.businessId,
      headMembershipId: schema.department.headMembershipId,
      active: schema.department.active,
    })
    .from(schema.department);
  const assignments = await tx
    .select({
      membershipId: schema.assignment.membershipId,
      businessId: schema.assignment.businessId,
      departmentId: schema.assignment.departmentId,
      positionName: schema.position.name,
      dutyName: schema.duty.name,
      positionRank: schema.position.rank,
      isPrimary: schema.assignment.isPrimary,
    })
    .from(schema.assignment)
    .leftJoin(schema.position, eq(schema.position.id, schema.assignment.positionId))
    .leftJoin(schema.duty, eq(schema.duty.id, schema.assignment.dutyId))
    .where(isNull(schema.assignment.validTo));
  return {
    members,
    departments,
    assignments: assignments.map(({ isPrimary: _isPrimary, ...a }) => a),
  };
}

export interface MemberCard {
  membershipId: string;
  name: string;
  departmentName: string | null;
  positionName: string | null;
  dutyName: string | null;
}

/** 결재선 단계에 저장할 처리자 스냅샷: 결재 시점의 이름·부서·직위·직책 (ORG-017) */
export async function loadMemberCards(tx: Tx, ids: string[]): Promise<Map<string, MemberCard>> {
  const rows = await tx
    .select({
      membershipId: schema.membership.id,
      name: schema.user.name,
      departmentName: schema.department.name,
      positionName: schema.position.name,
      dutyName: schema.duty.name,
      isPrimary: schema.assignment.isPrimary,
    })
    .from(schema.membership)
    .innerJoin(schema.user, eq(schema.user.id, schema.membership.userId))
    .leftJoin(schema.assignment, eq(schema.assignment.membershipId, schema.membership.id))
    .leftJoin(schema.department, eq(schema.department.id, schema.assignment.departmentId))
    .leftJoin(schema.position, eq(schema.position.id, schema.assignment.positionId))
    .leftJoin(schema.duty, eq(schema.duty.id, schema.assignment.dutyId));
  const wanted = new Set(ids);
  const cards = new Map<string, MemberCard & { primary: boolean }>();
  for (const r of rows) {
    if (!wanted.has(r.membershipId)) continue;
    const prev = cards.get(r.membershipId);
    // 주소속이 있으면 그것을 쓰고, 없으면 처음 읽은 행을 쓴다
    if (!prev || (r.isPrimary === true && !prev.primary)) {
      cards.set(r.membershipId, {
        membershipId: r.membershipId,
        name: r.name,
        departmentName: r.departmentName,
        positionName: r.positionName,
        dutyName: r.dutyName,
        primary: r.isPrimary === true,
      });
    }
  }
  return new Map([...cards].map(([id, { primary: _p, ...card }]) => [id, card]));
}
