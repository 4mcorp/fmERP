import type { DraftLineItem } from "./approval-line";
import type { ApprovalPolicy } from "./approval-types";
import type { FormField, FormSchema } from "./form-schema";

/**
 * 기본 양식 7종 (PRD APV-003). 계정을 만들 때 자동 등록한다.
 * 기본 결재선은 기안자의 부서장 계열(동적 대상)만 써서, 조직을 구성하기 전에도 해석된다.
 */
export interface DefaultForm {
  code: string;
  name: string;
  category: string;
  schema: FormSchema;
  defaultLine: DraftLineItem[];
  numbering: { rule: string; cycle: "year" | "month" | "none"; at: "submit" | "complete" };
  retentionYears: 1 | 3 | 5 | 10 | 0;
  securityDefault: "normal" | "confidential" | "secret";
  allowLineEdit: boolean;
  policy: ApprovalPolicy;
}

const body = (label = "내용"): FormField => ({
  key: "body",
  label,
  type: "richtext",
  required: true,
});
const files: FormField = { key: "files", label: "첨부", type: "attachment", maxFiles: 10 };
const head = (levels: number, seq: number): DraftLineItem => ({
  type: "approve",
  seq,
  target: { kind: "drafter_head", levels },
});

const POLICY: ApprovalPolicy = { disagree: "reject", rejectTo: "drafter", auditCanReject: true };
const NUMBERING = {
  rule: "{사업자코드}-{양식코드}-{YYYY}-{SEQ:4}",
  cycle: "year",
  at: "complete",
} as const;

const base = {
  numbering: NUMBERING,
  securityDefault: "normal",
  allowLineEdit: true,
  policy: POLICY,
} as const;

export const DEFAULT_FORMS: DefaultForm[] = [
  {
    ...base,
    code: "GENERAL",
    name: "일반 기안",
    category: "일반",
    retentionYears: 3,
    schema: { fields: [body(), files] },
    defaultLine: [head(1, 1)],
  },
  {
    ...base,
    code: "PROPOSAL",
    name: "품의서",
    category: "일반",
    retentionYears: 5,
    schema: {
      fields: [
        { key: "subject", label: "품의 제목", type: "text", required: true, maxLength: 100 },
        body("품의 내용"),
        files,
      ],
    },
    defaultLine: [head(1, 1), head(2, 2)],
  },
  {
    ...base,
    code: "EXPENSE",
    name: "지출결의서",
    category: "지출",
    retentionYears: 5,
    schema: {
      fields: [
        { key: "purpose", label: "지출 목적", type: "text", required: true, maxLength: 100 },
        { key: "amount", label: "총 지출 금액", type: "money", required: true, min: 1 },
        {
          key: "items",
          label: "지출 내역",
          type: "table",
          required: true,
          maxRows: 50,
          columns: [
            { key: "name", label: "항목", type: "text", required: true },
            { key: "price", label: "금액", type: "money", sum: true },
          ],
        },
        { key: "body", label: "비고", type: "richtext" },
        files,
      ],
    },
    defaultLine: [head(1, 1), head(2, 2)],
  },
  {
    ...base,
    code: "LEAVE",
    name: "휴가신청서",
    category: "인사",
    retentionYears: 3,
    schema: {
      fields: [
        {
          key: "kind",
          label: "휴가 구분",
          type: "select",
          required: true,
          options: [
            { value: "annual", label: "연차" },
            { value: "half", label: "반차" },
            { value: "sick", label: "병가" },
            { value: "etc", label: "기타" },
          ],
        },
        { key: "period", label: "기간", type: "daterange", required: true },
        { key: "reason", label: "사유", type: "textarea", required: true, maxLength: 500 },
        { key: "backup", label: "업무 인수자", type: "user" },
      ],
    },
    defaultLine: [head(1, 1)],
  },
  {
    ...base,
    code: "TRIP",
    name: "출장신청서",
    category: "인사",
    retentionYears: 3,
    schema: {
      fields: [
        { key: "destination", label: "출장지", type: "text", required: true, maxLength: 100 },
        { key: "period", label: "출장 기간", type: "daterange", required: true },
        { key: "purpose", label: "출장 목적", type: "textarea", required: true, maxLength: 500 },
        { key: "cost", label: "예상 경비", type: "money", min: 0 },
        { key: "report", label: "출장 결과 (보고서)", type: "richtext" },
        files,
      ],
    },
    defaultLine: [head(1, 1), head(2, 2)],
  },
  {
    ...base,
    code: "COOP",
    name: "업무협조전",
    category: "일반",
    retentionYears: 3,
    schema: {
      fields: [
        { key: "targetDept", label: "협조 요청 부서", type: "dept", required: true },
        { key: "dueDate", label: "회신 희망일", type: "date" },
        body("협조 요청 내용"),
        files,
      ],
    },
    defaultLine: [head(1, 1)],
  },
  {
    ...base,
    code: "PURCHASE",
    name: "구매요청서",
    category: "구매",
    retentionYears: 5,
    schema: {
      fields: [
        { key: "reason", label: "구매 사유", type: "textarea", required: true, maxLength: 500 },
        { key: "wantedDate", label: "납기 희망일", type: "date" },
        {
          key: "items",
          label: "구매 품목",
          type: "table",
          required: true,
          maxRows: 50,
          columns: [
            { key: "name", label: "품명", type: "text", required: true },
            { key: "qty", label: "수량", type: "number", required: true },
            { key: "price", label: "예상 금액", type: "money", sum: true },
          ],
        },
        files,
      ],
    },
    defaultLine: [head(1, 1), head(2, 2)],
  },
];
