"use client";

import { buildPdfHtml, type PdfApprover, type PdfInput } from "@fmerp/shared/domain/document-print";
import { type FormField, validateFormSchema } from "@fmerp/shared/domain/form-schema";
import { type FormDefinition, STEP_TYPE_LABEL } from "@fmerp/shared/lib/types";
import { useEffect, useState } from "react";

/** 편집 입력이 멈춘 뒤 미리보기를 다시 그리는 지연 시간 (ms) */
const DEBOUNCE_MS = 300;
const SAMPLE_MEMBER = "sample-member";
const SAMPLE_NAMES: Record<string, string> = { [SAMPLE_MEMBER]: "홍길동" };

function sampleCell(type: "text" | "number" | "money" | "date", label: string): unknown {
  switch (type) {
    case "number":
      return 2;
    case "money":
      return 10000;
    case "date":
      return "2026-10-15";
    default:
      return `${label} 입력 예시`;
  }
}

/** 필드 유형별 샘플 값 (입력값은 저장되지 않는다) */
function sampleValue(field: FormField): unknown {
  switch (field.type) {
    case "text":
    case "textarea":
      return `${field.label} 입력 예시`;
    case "number":
      return 1;
    case "money":
      return 1000000;
    case "date":
      return "2026-10-15";
    case "daterange":
      return { from: "2026-10-01", to: "2026-10-31" };
    case "select":
      return field.options[0]?.value;
    case "multiselect":
      return field.options.slice(0, 2).map((o) => o.value);
    case "user":
    case "dept":
      return field.multiple ? [SAMPLE_MEMBER] : SAMPLE_MEMBER;
    case "table":
      return [Object.fromEntries(field.columns.map((c) => [c.key, sampleCell(c.type, c.label)]))];
    case "richtext":
      return {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "본문 입력 예시입니다." }] },
        ],
      };
    default:
      return undefined;
  }
}

/** 편집 중인 정의로 완료 PDF와 같은 생성기(buildPdfHtml)를 호출한다. 스키마가 틀리면 null */
function buildSampleHtml(def: FormDefinition, name: string): string | null {
  if (!validateFormSchema(def.schema).ok) return null;
  const values = Object.fromEntries(def.schema.fields.map((f) => [f.key, sampleValue(f)]));
  const approvers: PdfApprover[] = def.defaultLine.map((item, i) => ({
    stepId: `sample-step-${i}`,
    type: item.type,
    label: STEP_TYPE_LABEL[item.type],
    name: `결재자 ${i + 1}`,
    position: null,
    status: "PENDING",
    at: null,
    onBehalfOfName: null,
  }));
  const input: PdfInput = {
    title: name || "새 양식",
    docNo: null,
    businessName: "사업장명",
    form: { name: name || "새 양식", schema: def.schema, layout: def.layout ?? {} },
    values,
    names: SAMPLE_NAMES,
    drafter: { membershipId: SAMPLE_MEMBER, name: "기안자", department: null, position: null },
    approvers,
    submittedAt: null,
    completedAt: null,
    contentHash: null,
    attachments: [],
  };
  return buildPdfHtml(input);
}

/** 양식 편집 화면의 A4 출력 미리보기. 같은 출처 HTML을 sandbox iframe에 srcdoc으로 그린다 (스크립트 없음, 저장하지 않음) */
export function FormPrintPreview({ def, name }: { def: FormDefinition; name: string }) {
  const [html, setHtml] = useState<string | null>(() => buildSampleHtml(def, name));

  useEffect(() => {
    const timer = setTimeout(() => setHtml(buildSampleHtml(def, name)), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [def, name]);

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">출력 미리보기</h2>
        <p className="text-xs text-muted-foreground">샘플 값으로 출력 모양을 보여 줍니다</p>
      </div>
      {html === null ? (
        <p className="rounded-md border p-4 text-sm text-muted-foreground">
          필드 정의를 고치면 출력 미리보기가 표시됩니다.
        </p>
      ) : (
        <iframe
          title="양식 출력 미리보기"
          srcDoc={html}
          sandbox=""
          className="h-[70vh] w-full rounded-md border bg-white"
        />
      )}
    </div>
  );
}
