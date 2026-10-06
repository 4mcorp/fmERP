import type { StepType } from "./approval-types";

/** 결재선 해석(APV-031)과 검증(APV-015·038). 조직 데이터는 호출 쪽이 스냅샷으로 넘기는 순수 함수 */

export interface OrgSnapshot {
  members: { membershipId: string; status: "active" | "leave" | "left" }[];
  departments: {
    id: string;
    parentId: string | null;
    businessId: string;
    headMembershipId: string | null;
    active: boolean;
  }[];
  /** 유효한(종료되지 않은) 소속만 */
  assignments: {
    membershipId: string;
    businessId: string;
    departmentId: string;
    positionName: string | null;
    dutyName: string | null;
    positionRank: number | null;
  }[];
}

type LineTarget =
  | { kind: "user"; membershipId: string }
  | { kind: "department"; departmentId: string; mode: "head" | "any" }
  | { kind: "drafter_head"; levels?: number }
  | { kind: "duty"; dutyName: string }
  | { kind: "business_ceo"; businessId: string; positionName?: string };

export interface DraftLineItem {
  type: StepType;
  seq: number;
  target: LineTarget;
  quorum?: "all" | number;
  canFinalize?: boolean;
}

export interface ResolvedLineItem {
  index: number;
  type: StepType;
  seq: number;
  assigneeIds: string[];
  quorum: "all" | number;
  canFinalize: boolean;
}

export type ResolveResult =
  | { ok: true; steps: ResolvedLineItem[] }
  | { ok: false; errors: { index: number; message: string }[] };

const DEFAULT_CEO_POSITION = "대표이사";

export function resolveLine(
  items: DraftLineItem[],
  org: OrgSnapshot,
  drafter: { membershipId: string; departmentId: string },
): ResolveResult {
  const active = new Set(
    org.members.filter((m) => m.status === "active").map((m) => m.membershipId),
  );
  const dept = new Map(org.departments.map((d) => [d.id, d]));
  const errors: { index: number; message: string }[] = [];
  const steps: ResolvedLineItem[] = [];

  const headOf = (id: string): string | null => {
    const d = dept.get(id);
    return d?.headMembershipId && active.has(d.headMembershipId) ? d.headMembershipId : null;
  };

  /** 기안자의 부서에서 위로 올라가며 기안자 본인이 아닌 활성 부서장을 모은다 */
  const headsAbove = (): string[] => {
    const heads: string[] = [];
    for (
      let cur = dept.get(drafter.departmentId);
      cur;
      cur = cur.parentId ? dept.get(cur.parentId) : undefined
    ) {
      const head = headOf(cur.id);
      if (head && head !== drafter.membershipId && !heads.includes(head)) heads.push(head);
    }
    return heads;
  };

  const resolveTarget = (target: LineTarget): { ids: string[] } | { error: string } => {
    switch (target.kind) {
      case "user":
        return active.has(target.membershipId)
          ? { ids: [target.membershipId] }
          : { error: "비활성이거나 없는 구성원입니다" };
      case "department": {
        if (!dept.get(target.departmentId)?.active) return { error: "사용할 수 없는 부서입니다" };
        if (target.mode === "head") {
          const head = headOf(target.departmentId);
          return head ? { ids: [head] } : { error: "부서장이 없거나 비활성입니다" };
        }
        const ids = [
          ...new Set(
            org.assignments
              .filter((a) => a.departmentId === target.departmentId && active.has(a.membershipId))
              .map((a) => a.membershipId),
          ),
        ];
        return ids.length > 0 ? { ids } : { error: "부서에 처리할 구성원이 없습니다" };
      }
      case "drafter_head": {
        const level = target.levels ?? 1;
        const head = headsAbove()[level - 1];
        return head
          ? { ids: [head] }
          : { error: `기안자의 상위 ${level}단계 부서장을 찾을 수 없습니다` };
      }
      case "duty": {
        const businessId = dept.get(drafter.departmentId)?.businessId;
        const ids = [
          ...new Set(
            org.assignments
              .filter(
                (a) =>
                  a.businessId === businessId &&
                  a.dutyName === target.dutyName &&
                  active.has(a.membershipId),
              )
              .map((a) => a.membershipId),
          ),
        ];
        return ids.length > 0
          ? { ids }
          : { error: `직책 "${target.dutyName}" 보유자를 찾을 수 없습니다` };
      }
      case "business_ceo": {
        const position = target.positionName ?? DEFAULT_CEO_POSITION;
        const ids = [
          ...new Set(
            org.assignments
              .filter(
                (a) =>
                  a.businessId === target.businessId &&
                  a.positionName === position &&
                  active.has(a.membershipId),
              )
              .map((a) => a.membershipId),
          ),
        ];
        return ids.length > 0 ? { ids } : { error: `사업자의 ${position}을(를) 찾을 수 없습니다` };
      }
    }
  };

  items.forEach((item, index) => {
    const r = resolveTarget(item.target);
    if ("error" in r) {
      errors.push({ index, message: r.error });
      return;
    }
    steps.push({
      index,
      type: item.type,
      seq: item.seq,
      assigneeIds: r.ids,
      quorum: item.quorum ?? "all",
      canFinalize: item.canFinalize ?? false,
    });
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, steps };
}

export interface ValidationOptions {
  drafterId: string;
  /** 같은 사람이 여러 단계에 있는 것을 허용할지 (허용해도 경고는 낸다) */
  allowDuplicate: boolean;
  /** 구성원 id → 직위 서열 */
  ranks: Map<string, number>;
  inactive: Set<string>;
  /**
   * 감사인 역할(`auditor`)을 가진 구성원 id. 주어지면 감사 단계의 처리자는 전부 여기에 있어야 한다 (AUD-001).
   * 생략하면 감사 단계 대상을 검사하지 않는다.
   */
  auditors?: Set<string>;
}

export interface LineValidation {
  errors: string[];
  warnings: string[];
}

/** 상신 전 결재선 검증. 오류가 있으면 상신을 막고, 경고는 안내만 한다 */
export function validateLine(
  steps: Pick<ResolvedLineItem, "type" | "seq" | "assigneeIds" | "quorum">[],
  opts: ValidationOptions,
): LineValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const flow = steps.filter((s) => s.type !== "post");
  if (flow.length === 0) {
    errors.push("결재 단계가 없습니다");
    return { errors, warnings };
  }
  if (steps.every((s) => s.assigneeIds.every((id) => id === opts.drafterId))) {
    errors.push("기안자 본인만 있는 결재선은 상신할 수 없습니다");
  }
  for (const s of steps) {
    if (s.assigneeIds.every((id) => opts.inactive.has(id))) {
      errors.push("비활성·퇴사 구성원만 처리자인 단계가 있습니다");
      break;
    }
  }

  const auditors = opts.auditors;
  if (auditors) {
    const notAuditor = steps.some(
      (s) => s.type === "audit" && s.assigneeIds.some((id) => !auditors.has(id)),
    );
    if (notAuditor) errors.push("감사 단계의 처리자는 감사인 역할을 가진 구성원이어야 합니다");
  }

  const groups = new Map<number, typeof flow>();
  for (const s of flow) groups.set(s.seq, [...(groups.get(s.seq) ?? []), s]);
  for (const group of groups.values()) {
    const quorum = group[0]?.quorum;
    if (typeof quorum === "number" && (quorum < 1 || quorum > group.length)) {
      errors.push(`병렬 그룹의 정족수(${quorum})가 올바르지 않습니다 (1~${group.length})`);
    }
  }

  const seen = new Map<string, number>();
  for (const s of steps) {
    if (s.assigneeIds.length !== 1) continue;
    const id = s.assigneeIds[0] as string;
    seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  if ([...seen.values()].some((n) => n > 1)) {
    (opts.allowDuplicate ? warnings : errors).push("같은 사람이 여러 단계에 중복되어 있습니다");
  }

  let highest = Number.NEGATIVE_INFINITY;
  for (const s of [...flow].filter((x) => x.type === "approve").sort((a, b) => a.seq - b.seq)) {
    if (s.assigneeIds.length !== 1) continue;
    const rank = opts.ranks.get(s.assigneeIds[0] as string);
    if (rank === undefined) continue;
    if (rank < highest) {
      warnings.push("서열이 낮은 결재자가 높은 결재자보다 뒤에 있습니다 (서열 역순)");
      break;
    }
    highest = rank;
  }
  return { errors, warnings };
}
