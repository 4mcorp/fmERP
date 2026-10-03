import type { DelegateDecision } from "./approval-types";

/** 부재·대결 규칙 (PRD APV-050·051·053). 순수 함수 */
export interface DelegationRule {
  /** 부재자 */
  membershipId: string;
  delegateId: string;
  from: Date;
  to: Date;
  scope: { kind: "all" } | { kind: "category"; categories: string[] };
}

function inPeriod(rule: DelegationRule, now: Date): boolean {
  return rule.from <= now && now <= rule.to;
}

/** 양식 분류가 범위에 드는지. 분류를 모르면(undefined) 전체 범위 규칙만 해당한다 */
function matchesCategory(rule: DelegationRule, category: string | undefined): boolean {
  if (rule.scope.kind === "all") return true;
  return category !== undefined && rule.scope.categories.includes(category);
}

function scopesOverlap(a: DelegationRule, b: DelegationRule): boolean {
  if (a.scope.kind === "all" || b.scope.kind === "all") return true;
  const bc = b.scope.categories;
  return a.scope.categories.some((c) => bc.includes(c));
}

const periodsOverlap = (a: DelegationRule, b: DelegationRule) => a.from <= b.to && b.from <= a.to;

/** 단계가 활성화될 때 처리자의 대결자를 정한다. 대결자도 부재이면 연쇄 위임 금지로 unavailable */
export function decideDelegate(
  assigneeId: string,
  rules: DelegationRule[],
  ctx: { now: Date; category?: string },
): DelegateDecision {
  const active = (r: DelegationRule) => inPeriod(r, ctx.now) && matchesCategory(r, ctx.category);
  const rule = rules.find((r) => r.membershipId === assigneeId && active(r));
  if (!rule) return { kind: "none" };
  const delegateAway = rules.some((r) => r.membershipId === rule.delegateId && active(r));
  return delegateAway
    ? { kind: "unavailable", delegateId: rule.delegateId }
    : { kind: "delegate", delegateId: rule.delegateId };
}

export type DelegationCheck = { ok: true } | { ok: false; reason: string };

/** 부재 설정을 저장하기 전 검증: 본인 위임·기간 역전·중복·연쇄 위임 금지 */
export function validateDelegation(
  next: DelegationRule,
  existing: DelegationRule[],
): DelegationCheck {
  if (next.delegateId === next.membershipId)
    return { ok: false, reason: "본인에게 위임할 수 없습니다" };
  if (next.from >= next.to) return { ok: false, reason: "종료일은 시작일 이후여야 합니다" };
  for (const r of existing) {
    if (!periodsOverlap(next, r) || !scopesOverlap(next, r)) continue;
    if (r.membershipId === next.membershipId) {
      return { ok: false, reason: "같은 기간에 이미 부재 설정이 있습니다" };
    }
    // 연쇄 위임 금지: 대결자가 같은 기간 부재이거나, 나에게 위임한 사람이 있는 경우
    if (r.membershipId === next.delegateId || r.delegateId === next.membershipId) {
      return { ok: false, reason: "연쇄 위임은 허용되지 않습니다" };
    }
  }
  return { ok: true };
}
