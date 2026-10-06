// 새 회사의 조직 기본값 설치. 계정 생성 API가 호출자(합성 루트)에게서 주입받는다
import { DEFAULT_POSITIONS } from "@fmerp/core";
import { type Db, type Executor, schema } from "@fmerp/db";
import { and, eq } from "drizzle-orm";

/** 직위 마스터 기본값 (ORG-030). 첫 사업자 등록은 온보딩 화면이 안내한다 (ORG-002) */
export async function installDefaultPositions(tx: Executor, accountId: string): Promise<void> {
  await tx.insert(schema.position).values(DEFAULT_POSITIONS.map((p) => ({ accountId, ...p })));
}

interface InvitationPreset {
  businessId?: string | null;
  departmentId?: string | null;
  positionId?: string | null;
  dutyId?: string | null;
}

/**
 * 초대에 지정된 사업자·부서·직위로 주소속을 만든다. 그 사이 부서나 사업자를 쓸 수 없게 되었으면
 * 소속 없이 합류시킨다(관리자가 나중에 발령한다).
 */
export async function applyInvitationPreset(
  db: Db,
  input: {
    accountId: string;
    userId: string;
    createdBy: string;
    preset: InvitationPreset;
    now: Date;
  },
) {
  const { preset } = input;
  if (!preset.businessId || !preset.departmentId) return;
  const [dept] = await db
    .select({ id: schema.department.id })
    .from(schema.department)
    .innerJoin(schema.business, eq(schema.business.id, schema.department.businessId))
    .where(
      and(
        eq(schema.department.id, preset.departmentId),
        eq(schema.department.businessId, preset.businessId),
        eq(schema.department.accountId, input.accountId),
        eq(schema.department.active, true),
        eq(schema.business.active, true),
      ),
    );
  if (!dept) return;
  const [member] = await db
    .select({ id: schema.membership.id })
    .from(schema.membership)
    .where(
      and(
        eq(schema.membership.accountId, input.accountId),
        eq(schema.membership.userId, input.userId),
      ),
    );
  if (!member) return;
  const [created] = await db
    .insert(schema.assignment)
    .values({
      accountId: input.accountId,
      membershipId: member.id,
      businessId: preset.businessId,
      departmentId: preset.departmentId,
      positionId: preset.positionId ?? null,
      dutyId: preset.dutyId ?? null,
      isPrimary: true,
      validFrom: input.now,
    })
    .returning({ id: schema.assignment.id });
  await db.insert(schema.assignmentHistory).values({
    accountId: input.accountId,
    membershipId: member.id,
    assignmentId: created?.id ?? null,
    action: "create",
    changes: { ...preset, isPrimary: true },
    effectiveDate: input.now.toISOString().slice(0, 10),
    reason: "초대 수락",
    actorUserId: input.createdBy,
  });
}
