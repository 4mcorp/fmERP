import { describe, expect, it } from "vitest";
import { type OrgSnapshot, resolveLine, validateLine } from "./approval-line";

// 경영지원본부(hq, 부서장 boss) > 재무팀(fin, 부서장 lead) > 자금파트(cash, 부서장 없음)
const org: OrgSnapshot = {
  members: [
    { membershipId: "drafter", status: "active" },
    { membershipId: "lead", status: "active" },
    { membershipId: "boss", status: "active" },
    { membershipId: "ceo", status: "active" },
    { membershipId: "m1", status: "active" },
    { membershipId: "m2", status: "active" },
    { membershipId: "gone", status: "left" },
    { membershipId: "dir", status: "active" },
  ],
  departments: [
    { id: "hq", parentId: null, businessId: "b1", headMembershipId: "boss", active: true },
    { id: "fin", parentId: "hq", businessId: "b1", headMembershipId: "lead", active: true },
    { id: "cash", parentId: "fin", businessId: "b1", headMembershipId: null, active: true },
    { id: "sales", parentId: null, businessId: "b1", headMembershipId: "gone", active: true },
  ],
  assignments: [
    {
      membershipId: "drafter",
      businessId: "b1",
      departmentId: "cash",
      positionName: "사원",
      dutyName: null,
      positionRank: 10,
    },
    {
      membershipId: "lead",
      businessId: "b1",
      departmentId: "fin",
      positionName: "과장",
      dutyName: "팀장",
      positionRank: 40,
    },
    {
      membershipId: "boss",
      businessId: "b1",
      departmentId: "hq",
      positionName: "이사",
      dutyName: "본부장",
      positionRank: 70,
    },
    {
      membershipId: "ceo",
      businessId: "b1",
      departmentId: "hq",
      positionName: "대표이사",
      dutyName: null,
      positionRank: 120,
    },
    {
      membershipId: "m1",
      businessId: "b1",
      departmentId: "fin",
      positionName: "대리",
      dutyName: null,
      positionRank: 30,
    },
    {
      membershipId: "m2",
      businessId: "b1",
      departmentId: "fin",
      positionName: "사원",
      dutyName: null,
      positionRank: 10,
    },
    {
      membershipId: "gone",
      businessId: "b1",
      departmentId: "fin",
      positionName: "사원",
      dutyName: null,
      positionRank: 10,
    },
    {
      membershipId: "dir",
      businessId: "b2",
      departmentId: "other",
      positionName: "대표이사",
      dutyName: null,
      positionRank: 120,
    },
  ],
};
const drafter = { membershipId: "drafter", departmentId: "cash" };

const resolve = (target: Parameters<typeof resolveLine>[0][number]["target"]) =>
  resolveLine([{ type: "approve", seq: 1, target }], org, drafter);

describe("결재선 해석 (APV-031)", () => {
  it("특정 사용자", () => {
    expect(resolve({ kind: "user", membershipId: "lead" })).toMatchObject({
      ok: true,
      steps: [{ assigneeIds: ["lead"] }],
    });
  });

  it("비활성·없는 사용자는 해석 실패", () => {
    expect(resolve({ kind: "user", membershipId: "gone" })).toMatchObject({ ok: false });
    expect(resolve({ kind: "user", membershipId: "nobody" })).toMatchObject({ ok: false });
  });

  it("부서 대상: 부서장(head) 또는 부서원 중 1명(any)", () => {
    expect(resolve({ kind: "department", departmentId: "fin", mode: "head" })).toMatchObject({
      ok: true,
      steps: [{ assigneeIds: ["lead"] }],
    });
    const any = resolve({ kind: "department", departmentId: "fin", mode: "any" });
    expect(any).toMatchObject({ ok: true });
    if (any.ok) expect([...(any.steps[0]?.assigneeIds ?? [])].sort()).toEqual(["lead", "m1", "m2"]); // 퇴사자 제외
  });

  it("부서장이 없거나 비활성이면 실패", () => {
    expect(resolve({ kind: "department", departmentId: "cash", mode: "head" })).toMatchObject({
      ok: false,
    });
    expect(resolve({ kind: "department", departmentId: "sales", mode: "head" })).toMatchObject({
      ok: false,
    });
  });

  it("기안자의 부서장: 자기 부서에 부서장이 없으면 위로 올라간다", () => {
    expect(resolve({ kind: "drafter_head" })).toMatchObject({
      ok: true,
      steps: [{ assigneeIds: ["lead"] }],
    });
  });

  it("상위 N단계 부서장", () => {
    expect(resolve({ kind: "drafter_head", levels: 2 })).toMatchObject({
      steps: [{ assigneeIds: ["boss"] }],
    });
    expect(resolve({ kind: "drafter_head", levels: 3 })).toMatchObject({ ok: false });
  });

  it("기안자가 부서장이면 자기 자신은 건너뛴다", () => {
    const result = resolveLine(
      [{ type: "approve", seq: 1, target: { kind: "drafter_head" } }],
      org,
      {
        membershipId: "lead",
        departmentId: "fin",
      },
    );
    expect(result).toMatchObject({ ok: true, steps: [{ assigneeIds: ["boss"] }] });
  });

  it("직책 = X: 기안자 사업자에서 그 직책 보유자", () => {
    expect(resolve({ kind: "duty", dutyName: "본부장" })).toMatchObject({
      steps: [{ assigneeIds: ["boss"] }],
    });
    expect(resolve({ kind: "duty", dutyName: "없는직책" })).toMatchObject({ ok: false });
  });

  it("특정 사업자의 대표이사", () => {
    expect(resolve({ kind: "business_ceo", businessId: "b1" })).toMatchObject({
      steps: [{ assigneeIds: ["ceo"] }],
    });
    expect(resolve({ kind: "business_ceo", businessId: "b2" })).toMatchObject({
      steps: [{ assigneeIds: ["dir"] }],
    });
    expect(resolve({ kind: "business_ceo", businessId: "b3" })).toMatchObject({ ok: false });
  });

  it("모든 실패를 항목 번호와 함께 모아서 돌려준다", () => {
    const result = resolveLine(
      [
        { type: "approve", seq: 1, target: { kind: "user", membershipId: "gone" } },
        { type: "approve", seq: 2, target: { kind: "user", membershipId: "lead" } },
        { type: "approve", seq: 3, target: { kind: "business_ceo", businessId: "b3" } },
      ],
      org,
      drafter,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((e) => e.index)).toEqual([0, 2]);
  });

  it("단계 속성(유형·순번·정족수·전결)을 그대로 이어받는다", () => {
    const result = resolveLine(
      [
        {
          type: "agree",
          seq: 2,
          quorum: 1,
          canFinalize: false,
          target: { kind: "department", departmentId: "fin", mode: "any" },
        },
      ],
      org,
      drafter,
    );
    expect(result).toMatchObject({
      ok: true,
      steps: [{ type: "agree", seq: 2, quorum: 1, canFinalize: false }],
    });
  });
});

describe("결재선 검증 (APV-015·038)", () => {
  const base = {
    drafterId: "drafter",
    allowDuplicate: false,
    ranks: new Map<string, number>(),
    inactive: new Set<string>(),
  };
  const s = (seq: number, assigneeIds: string[], extra: Record<string, unknown> = {}) => ({
    index: seq - 1,
    type: "approve" as const,
    seq,
    assigneeIds,
    quorum: "all" as const,
    ...extra,
  });

  it("정상 결재선", () => {
    expect(validateLine([s(1, ["lead"]), s(2, ["boss"])], base)).toEqual({
      errors: [],
      warnings: [],
    });
  });

  it("단계가 없거나 후결뿐이면 오류", () => {
    expect(validateLine([], base).errors.length).toBeGreaterThan(0);
    expect(validateLine([s(1, ["lead"], { type: "post" })], base).errors.length).toBeGreaterThan(0);
  });

  it("기안자 본인만 있는 결재선은 오류", () => {
    expect(validateLine([s(1, ["drafter"])], base).errors.join()).toMatch(/본인/);
  });

  it("비활성·퇴사자가 처리자의 전부인 단계는 오류", () => {
    const withGone = { ...base, inactive: new Set(["gone"]) };
    expect(validateLine([s(1, ["gone"])], withGone).errors.join()).toMatch(/비활성/);
    expect(validateLine([s(1, ["gone", "lead"])], withGone).errors).toEqual([]);
  });

  it("같은 사람이 여러 단계에 있으면 경고, 허용하지 않는 설정이면 오류", () => {
    const line = [s(1, ["lead"]), s(2, ["boss"]), s(3, ["lead"])];
    expect(validateLine(line, { ...base, allowDuplicate: true }).warnings.join()).toMatch(/중복/);
    expect(validateLine(line, base).errors.join()).toMatch(/중복/);
  });

  it("서열 역순(상위 직위가 먼저, 하위가 나중) 경고", () => {
    const ranks = new Map([
      ["lead", 40],
      ["boss", 70],
    ]);
    expect(
      validateLine([s(1, ["boss"]), s(2, ["lead"])], { ...base, ranks }).warnings.join(),
    ).toMatch(/서열/);
    expect(validateLine([s(1, ["lead"]), s(2, ["boss"])], { ...base, ranks }).warnings).toEqual([]);
  });

  it("정족수가 그룹 크기를 넘거나 1 미만이면 오류", () => {
    const g = (quorum: number | "all") => [
      s(1, ["lead"], { type: "agree", quorum }),
      s(1, ["boss"], { type: "agree", quorum }),
    ];
    expect(validateLine(g(3), base).errors.join()).toMatch(/정족수/);
    expect(validateLine(g(0), base).errors.join()).toMatch(/정족수/);
    expect(validateLine(g(2), base).errors).toEqual([]);
  });
});
