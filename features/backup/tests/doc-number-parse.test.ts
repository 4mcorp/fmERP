import { renderDocNumber } from "@fmerp/shared/domain/doc-number";
import { describe, expect, it } from "vitest";
import { parseDocNumberSeq } from "../src/domain/doc-number-parse";

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
