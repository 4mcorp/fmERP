import { validateDocNumberRule, validateFormSchema, validateFormValues } from "@fmerp/core";
import { describe, expect, it } from "vitest";
import { DEFAULT_FORMS } from "../src/domain/form-defaults";

describe("기본 양식 7종 (APV-003)", () => {
  it("일반 기안·품의서·지출결의서·휴가신청서·출장 신청서·업무협조전·구매요청서가 있다", () => {
    expect(DEFAULT_FORMS.map((f) => f.name)).toEqual([
      "일반 기안",
      "품의서",
      "지출결의서",
      "휴가신청서",
      "출장신청서",
      "업무협조전",
      "구매요청서",
    ]);
    expect(new Set(DEFAULT_FORMS.map((f) => f.code)).size).toBe(DEFAULT_FORMS.length);
  });

  for (const form of DEFAULT_FORMS) {
    it(`${form.name}: 스키마·문서번호 규칙·결재선이 유효하다`, () => {
      expect(validateFormSchema(form.schema)).toEqual({ ok: true });
      expect(validateDocNumberRule(form.numbering.rule)).toEqual({ ok: true });
      expect(form.defaultLine.length).toBeGreaterThan(0);
      expect([1, 3, 5, 10, 0]).toContain(form.retentionYears);
      // 결재선은 조직 구조에 의존하지 않는 동적 대상만 쓴다 (계정 생성 직후에도 동작)
      for (const item of form.defaultLine) expect(item.target.kind).toBe("drafter_head");
    });
  }

  it("지출결의서는 금액과 내역 표(합계)를 가지며 정상 입력이 통과한다", () => {
    const expense = DEFAULT_FORMS.find((f) => f.code === "EXPENSE");
    expect(expense).toBeTruthy();
    const result = validateFormValues(expense?.schema ?? { fields: [] }, {
      purpose: "회식비",
      amount: 150_000,
      items: [{ name: "식대", price: 150_000 }],
      body: { type: "doc", content: [] },
    });
    expect(result).toMatchObject({ ok: true });
  });

  it("휴가신청서는 기간 필드가 필수이다", () => {
    const leave = DEFAULT_FORMS.find((f) => f.code === "LEAVE");
    const empty = validateFormValues(leave?.schema ?? { fields: [] }, { reason: "개인 사유" });
    expect(empty.ok).toBe(false);
  });
});
