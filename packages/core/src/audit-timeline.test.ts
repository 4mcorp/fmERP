import { describe, expect, it } from "vitest";
import { buildTimeline, type TimelineInput } from "./audit-timeline";

const t = (s: string) => new Date(`2026-10-0${s}Z`);
const empty = (): TimelineInput => ({
  actions: [],
  events: [],
  logs: [],
  includeViews: false,
  includeIp: false,
});

describe("문서 이력 타임라인 (AUD-011)", () => {
  it("작성 → 상신 → 단계 처리 → 완료를 시각순으로 놓는다", () => {
    const items = buildTimeline({
      ...empty(),
      logs: [
        {
          at: t("1T01:00:00"),
          action: "approval.submit",
          actor: "박사원",
          reason: null,
          ip: "1.1.1.1",
        },
        {
          at: t("1T00:00:00"),
          action: "approval.create",
          actor: "박사원",
          reason: null,
          ip: "1.1.1.1",
        },
      ],
      actions: [
        {
          at: t("2T01:00:00"),
          kind: "approve",
          actor: "최대리",
          onBehalfOf: null,
          comment: "승인합니다",
        },
      ],
      events: [{ at: t("2T01:00:01"), type: "completed" }],
    });
    expect(items.map((i) => i.kind)).toEqual(["create", "submit", "approve", "completed"]);
    expect(items.map((i) => i.label)).toEqual(["작성", "상신", "승인", "완료"]);
  });

  it("대결은 원 결재자와 함께 표시한다", () => {
    const items = buildTimeline({
      ...empty(),
      actions: [
        {
          at: t("2T01:00:00"),
          kind: "approve",
          actor: "대결자",
          onBehalfOf: "정팀장",
          comment: null,
        },
      ],
    });
    expect(items[0]).toMatchObject({ actor: "대결자", onBehalfOf: "정팀장", label: "승인" });
  });

  it("단계 처리는 approval_action이 정본이라 감사 로그의 같은 사건은 제외한다", () => {
    const items = buildTimeline({
      ...empty(),
      actions: [
        { at: t("2T01:00:00"), kind: "reject", actor: "최대리", onBehalfOf: null, comment: "보완" },
      ],
      logs: [
        {
          at: t("2T01:00:00"),
          action: "approval.reject",
          actor: "최대리",
          reason: "보완",
          ip: null,
        },
        {
          at: t("2T01:00:00"),
          action: "approval.audit_approve",
          actor: "감사",
          reason: null,
          ip: null,
        },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("reject");
    expect(items[0]?.detail).toBe("보완");
  });

  it("결재선 변경·다운로드·인쇄·공람은 감사 로그에서 가져온다", () => {
    const logs = [
      ["approval.line_change", "사유 있음"],
      ["document.download_pdf", null],
      ["document.print", null],
      ["document.circulate", null],
      ["approval.transfer", "인수인계"],
    ] as const;
    const items = buildTimeline({
      ...empty(),
      logs: logs.map(([action, reason], i) => ({
        at: t(`3T0${i}:00:00`),
        action,
        actor: "홍",
        reason,
        ip: null,
      })),
    });
    expect(items.map((i) => i.label)).toEqual([
      "결재선 변경",
      "PDF 내려받기",
      "인쇄",
      "공람 지정",
      "결재자 이관",
    ]);
    expect(items[0]?.detail).toBe("사유 있음");
  });

  it("임시저장은 이력에 넣지 않고, 감사 열람은 includeViews일 때만 넣는다", () => {
    const logs = [
      { at: t("1T00:00:00"), action: "approval.save_draft", actor: "홍", reason: null, ip: null },
      {
        at: t("1T00:00:01"),
        action: "document.audit_view",
        actor: "감사인",
        reason: null,
        ip: null,
      },
    ];
    expect(buildTimeline({ ...empty(), logs })).toEqual([]);
    expect(buildTimeline({ ...empty(), logs, includeViews: true }).map((i) => i.label)).toEqual([
      "감사 열람",
    ]);
  });

  it("IP는 includeIp일 때만 담는다", () => {
    const logs = [
      { at: t("1T00:00:00"), action: "approval.create", actor: "홍", reason: null, ip: "9.9.9.9" },
    ];
    expect(buildTimeline({ ...empty(), logs })[0]?.ip).toBeNull();
    expect(buildTimeline({ ...empty(), logs, includeIp: true })[0]?.ip).toBe("9.9.9.9");
  });

  it("알 수 없는 문서 관련 행위는 행위 이름 그대로 보인다 (누락 방지)", () => {
    const items = buildTimeline({
      ...empty(),
      logs: [
        {
          at: t("1T00:00:00"),
          action: "document.something_new",
          actor: "홍",
          reason: null,
          ip: null,
        },
      ],
    });
    expect(items[0]?.label).toBe("document.something_new");
  });

  it("같은 시각이면 입력 순서를 유지한다", () => {
    const items = buildTimeline({
      ...empty(),
      logs: [
        { at: t("1T00:00:00"), action: "approval.create", actor: "홍", reason: null, ip: null },
        { at: t("1T00:00:00"), action: "approval.submit", actor: "홍", reason: null, ip: null },
      ],
    });
    expect(items.map((i) => i.kind)).toEqual(["create", "submit"]);
  });
});
