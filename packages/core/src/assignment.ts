/** 사용자 소속(겸직)·발령 규칙 (PRD ORG-032~035, ORG-017) */
export interface AssignmentInput {
  id: string;
  businessId: string;
  departmentId: string;
  positionId: string | null;
  dutyId: string | null;
  isPrimary: boolean;
  validFrom: Date;
  validTo: Date | null;
}

export function isAssignmentActive(a: AssignmentInput, now: Date): boolean {
  return a.validFrom <= now && (a.validTo === null || now < a.validTo);
}

export type AssignmentsCheck = { ok: true } | { ok: false; reason: string };

/** 유효한 소속이 있으면 주소속이 정확히 1개여야 한다 (ORG-032) */
export function validateAssignments(list: AssignmentInput[], now: Date): AssignmentsCheck {
  const active = list.filter((a) => isAssignmentActive(a, now));
  if (active.length === 0) return { ok: true };
  const primaries = active.filter((a) => a.isPrimary).length;
  if (primaries !== 1) {
    return { ok: false, reason: "주소속은 정확히 1개여야 합니다" };
  }
  return { ok: true };
}

/** 기안 소속 선택. 지정이 없으면 주소속 (ORG-033). 유효하지 않으면 null */
export function pickDraftAssignment(
  list: AssignmentInput[],
  requestedId: string | undefined,
  now: Date,
): AssignmentInput | null {
  const active = list.filter((a) => isAssignmentActive(a, now));
  if (requestedId === undefined) return active.find((a) => a.isPrimary) ?? null;
  return active.find((a) => a.id === requestedId) ?? null;
}

const TRACKED = ["businessId", "departmentId", "positionId", "dutyId", "isPrimary"] as const;

/** 발령 이력에 남길 변경 항목 (ORG-035) */
export function assignmentChanges(before: AssignmentInput, after: AssignmentInput) {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of TRACKED) {
    if (before[key] !== after[key]) changes[key] = { from: before[key], to: after[key] };
  }
  return changes;
}

export interface AssignmentSnapshot {
  businessName: string;
  departmentName: string;
  positionName: string | null;
  dutyName: string | null;
}

/** 결재 문서에 저장할 기안·결재 시점의 소속 스냅샷 (ORG-017) */
export function snapshotAssignment(input: AssignmentSnapshot): AssignmentSnapshot {
  return { ...input };
}
