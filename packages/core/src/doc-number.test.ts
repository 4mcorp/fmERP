import { describe, expect, it } from "vitest";
import { parseDocNumberSeq } from "../../../features/backup/src/domain/doc-number-parse";
import { renderDocNumber, seriesKey, validateDocNumberRule } from "./doc-number";

const ctx = {
  businessCode: "4M",
  departmentCode: "FIN",
  formCode: "EXP",
  date: new Date("2026-10-03T09:00:00+09:00"),
};

describe("문서번호 규칙 검증 (APV-060)", () => {
  it("유효한 규칙은 통과한다", () => {
    expect(validateDocNumberRule("{사업자코드}-{부서코드}-{YYYY}-{SEQ:4}")).toEqual({ ok: true });
    expect(validateDocNumberRule("{양식코드}{YY}{MM}-{SEQ:3}")).toEqual({ ok: true });
  });

  it("알 수 없는 토큰, SEQ 없음·중복, 자릿수 범위 오류는 거부", () => {
    expect(validateDocNumberRule("{사업자코드}-{모름}-{SEQ:4}")).toMatchObject({ ok: false });
    expect(validateDocNumberRule("{사업자코드}-{YYYY}")).toMatchObject({ ok: false });
    expect(validateDocNumberRule("{SEQ:4}-{SEQ:4}")).toMatchObject({ ok: false });
    expect(validateDocNumberRule("{SEQ:0}")).toMatchObject({ ok: false });
    expect(validateDocNumberRule("{SEQ:11}")).toMatchObject({ ok: false });
    expect(validateDocNumberRule("{SEQ}")).toMatchObject({ ok: false });
  });
});

describe("문서번호 렌더링", () => {
  it("예시 4M-FIN-2026-0012", () => {
    expect(renderDocNumber("{사업자코드}-{부서코드}-{YYYY}-{SEQ:4}", { ...ctx, seq: 12 })).toBe(
      "4M-FIN-2026-0012",
    );
  });

  it("연·월 토큰은 서울 시간 기준이다 (UTC 자정 직전·직후 경계)", () => {
    const edge = new Date("2026-12-31T16:00:00Z"); // 서울 2027-01-01 01:00
    expect(renderDocNumber("{YYYY}{YY}{MM}-{SEQ:2}", { ...ctx, date: edge, seq: 1 })).toBe(
      "20272701-01",
    );
  });

  it("자릿수보다 큰 번호는 그대로 늘어난다", () => {
    expect(renderDocNumber("{SEQ:2}", { ...ctx, seq: 123 })).toBe("123");
  });
});

describe("시리즈 키 (APV-061)", () => {
  const rule = "{사업자코드}-{부서코드}-{YYYY}-{SEQ:4}";

  it("부서·양식 코드가 다르면 다른 시리즈, 같으면 같은 시리즈", () => {
    const a = seriesKey(rule, ctx, "year");
    expect(seriesKey(rule, ctx, "year")).toBe(a);
    expect(seriesKey(rule, { ...ctx, departmentCode: "HR" }, "year")).not.toBe(a);
  });

  it("초기화 주기: 연은 해마다, 월은 달마다, 안 함은 하나", () => {
    const next = { ...ctx, date: new Date("2027-01-02T09:00:00+09:00") };
    const nextMonth = { ...ctx, date: new Date("2026-11-02T09:00:00+09:00") };
    expect(seriesKey(rule, ctx, "year")).not.toBe(seriesKey(rule, next, "year"));
    expect(seriesKey(rule, ctx, "year")).toBe(seriesKey(rule, nextMonth, "year"));
    expect(seriesKey(rule, ctx, "month")).not.toBe(seriesKey(rule, nextMonth, "month"));
    expect(seriesKey("{SEQ:4}", ctx, "none")).toBe(seriesKey("{SEQ:4}", next, "none"));
  });
});

describe("문서번호에서 순번 되읽기 (색인 재구성)", () => {
  const readCtx = {
    businessCode: "4M",
    departmentCode: "FIN",
    formCode: "GEN",
    date: new Date("2026-10-02T01:00:00Z"),
  };

  it("렌더링한 번호에서 일련번호를 되읽는다", () => {
    const rule = "{사업자코드}-{부서코드}-{YYYY}-{SEQ:4}";
    expect(parseDocNumberSeq(rule, readCtx, "4M-FIN-2026-0012")).toBe(12);
    expect(parseDocNumberSeq(rule, readCtx, renderDocNumber(rule, { ...readCtx, seq: 7 }))).toBe(7);
    // 자릿수보다 큰 번호
    expect(parseDocNumberSeq(rule, readCtx, "4M-FIN-2026-123456")).toBe(123456);
  });

  it("규칙의 앞뒤 글자와 다르면 null (다른 규칙·다른 해의 번호는 이 시리즈가 아니다)", () => {
    const rule = "{사업자코드}-{부서코드}-{YYYY}-{SEQ:4}";
    expect(parseDocNumberSeq(rule, readCtx, "4M-FIN-2025-0012")).toBeNull();
    expect(parseDocNumberSeq(rule, readCtx, "4M-HR-2026-0012")).toBeNull();
    expect(parseDocNumberSeq(rule, readCtx, "4M-FIN-2026-00ab")).toBeNull();
    expect(parseDocNumberSeq(rule, readCtx, "")).toBeNull();
  });

  it("정규식 특수문자가 규칙에 있어도 글자 그대로 비교한다", () => {
    const rule = "[{양식코드}].{SEQ:3}(끝)";
    expect(parseDocNumberSeq(rule, readCtx, "[GEN].042(끝)")).toBe(42);
    expect(parseDocNumberSeq(rule, readCtx, "[GEN]X042(끝)")).toBeNull();
  });
});
