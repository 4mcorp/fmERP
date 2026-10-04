import { describe, expect, it } from "vitest";
import {
  type ApprovalRecordInput,
  buildApprovalJson,
  buildDocumentJson,
  buildManifest,
  canonicalJson,
} from "./completion-package";

const record = (): ApprovalRecordInput => ({
  documentId: "d-1",
  docNo: "FM-GEN-2026-0001",
  title: "출장 정산",
  contentHash: "c".repeat(64),
  securityLevel: "normal",
  status: "COMPLETED",
  submittedAt: "2026-10-01T01:00:00.000Z",
  completedAt: "2026-10-02T01:00:00.000Z",
  drafter: { membershipId: "m-1", name: "박사원", department: "재무팀", position: "사원" },
  steps: [
    {
      id: "s-1",
      seq: 1,
      type: "approve",
      status: "APPROVED",
      quorum: null,
      canFinalize: false,
      assignees: [{ membershipId: "m-2", name: "최대리", department: "재무팀", position: "대리" }],
    },
    {
      id: "s-2",
      seq: 2,
      type: "post",
      status: "POST_PENDING",
      quorum: null,
      canFinalize: false,
      assignees: [{ membershipId: "m-3", name: "송인사", department: "인사팀", position: "과장" }],
    },
  ],
  actions: [
    {
      stepId: "s-1",
      actorMembershipId: "m-2",
      actorName: "최대리",
      onBehalfOfMembershipId: null,
      onBehalfOfName: null,
      action: "approve",
      comment: "확인했습니다",
      ip: "203.0.113.5",
      at: "2026-10-02T01:00:00.000Z",
      docHash: "c".repeat(64),
    },
  ],
  attachments: [
    {
      id: "a-1",
      filename: "영수증.pdf",
      key: "docs/acc/FM/2026/d-1/attachments/a-1_영수증.pdf",
      size: 1024,
      sha256: "a".repeat(64),
      mime: "application/pdf",
    },
  ],
});

describe("canonicalJson", () => {
  it("객체 키를 정렬해 입력 순서와 상관없이 같은 문자열을 만든다", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 2], c: "x" } })).toBe(
      canonicalJson({ a: { c: "x", d: [3, 2] }, b: 1 }),
    );
  });

  it("배열 순서는 유지하고 undefined 값은 빼며 한글은 그대로 둔다", () => {
    const text = canonicalJson({ list: [2, 1], gone: undefined, name: "한글" });
    expect(text).toContain('"list": [\n    2,\n    1\n  ]');
    expect(text).not.toContain("gone");
    expect(text).toContain("한글");
    expect(text.endsWith("\n")).toBe(true);
  });
});

describe("buildApprovalJson (BAK-003)", () => {
  it("결재선·처리 이력·문서번호·상신 해시와 첨부 참조를 담는다", () => {
    const json = buildApprovalJson(record());
    expect(json).toMatchObject({
      schemaVersion: 1,
      documentId: "d-1",
      docNo: "FM-GEN-2026-0001",
      contentHash: "c".repeat(64),
      completedAt: "2026-10-02T01:00:00.000Z",
    });
    expect(json.steps).toHaveLength(2);
    expect(json.actions[0]).toMatchObject({
      actorName: "최대리",
      ip: "203.0.113.5",
      comment: "확인했습니다",
      docHash: "c".repeat(64),
    });
    expect(json.attachments[0]).toMatchObject({ filename: "영수증.pdf", sha256: "a".repeat(64) });
  });

  it("완료 시점에 후결 대기인 단계를 따로 적는다 (이후 승인은 post-approvals에 기록)", () => {
    expect(buildApprovalJson(record()).pendingPostSteps).toEqual(["s-2"]);
  });

  it("처리 이력은 시각순으로 정렬하고, 대결은 원 결재자와 함께 적는다", () => {
    const r = record();
    r.actions.push({
      stepId: "s-1",
      actorMembershipId: "m-9",
      actorName: "대결자",
      onBehalfOfMembershipId: "m-2",
      onBehalfOfName: "최대리",
      action: "approve",
      comment: null,
      ip: null,
      at: "2026-10-01T05:00:00.000Z",
      docHash: null,
    });
    const json = buildApprovalJson(r);
    expect(json.actions.map((a) => a.actorName)).toEqual(["대결자", "최대리"]);
    expect(json.actions[0]).toMatchObject({ onBehalfOfName: "최대리" });
  });

  it("같은 입력이면 입력 객체의 키 순서와 상관없이 같은 바이트가 나온다", () => {
    const a = canonicalJson(buildApprovalJson(record()));
    const reverseKeys = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(reverseKeys)
        : v && typeof v === "object"
          ? Object.fromEntries(
              Object.entries(v)
                .reverse()
                .map(([k, x]) => [k, reverseKeys(x)]),
            )
          : v;
    const reordered = reverseKeys(record()) as ApprovalRecordInput;
    expect(canonicalJson(buildApprovalJson(reordered))).toBe(a);
  });
});

describe("buildDocumentJson", () => {
  it("작성 당시 양식 버전과 입력값, 마지막 리비전 정보를 담는다", () => {
    const json = buildDocumentJson({
      documentId: "d-1",
      docNo: "FM-GEN-2026-0001",
      title: "출장 정산",
      businessCode: "FM",
      securityLevel: "normal",
      urgent: false,
      desiredDueDate: null,
      submittedAt: "2026-10-01T01:00:00.000Z",
      form: { code: "GEN", name: "일반 기안", version: 3, schema: { fields: [] } },
      values: { memo: "서울" },
      revision: { n: 2, key: "docs/x/revisions/2.json", sha256: "e".repeat(64) },
    });
    expect(json).toMatchObject({
      schemaVersion: 1,
      form: { code: "GEN", version: 3 },
      values: { memo: "서울" },
      revision: { n: 2, sha256: "e".repeat(64) },
    });
  });
});

describe("buildManifest (BAK-003)", () => {
  const files = [
    { path: "document.pdf", size: 9, sha256: "1".repeat(64) },
    { path: "document.json", size: 2, sha256: "2".repeat(64) },
    { path: "approval.json", size: 2, sha256: "3".repeat(64) },
  ];

  it("패키지 파일의 경로·크기·SHA-256을 경로순으로 적고 첨부는 참조로 적는다", () => {
    const m = buildManifest({
      documentId: "d-1",
      files,
      attachments: record().attachments,
    });
    expect(m.files.map((f) => f.path)).toEqual(["approval.json", "document.json", "document.pdf"]);
    expect(m.files[0]).toEqual({ path: "approval.json", size: 2, sha256: "3".repeat(64) });
    expect(m.attachments[0]).toMatchObject({
      key: "docs/acc/FM/2026/d-1/attachments/a-1_영수증.pdf",
      sha256: "a".repeat(64),
    });
  });

  it("manifest 자신은 파일 목록에 넣지 않는다", () => {
    const m = buildManifest({ documentId: "d-1", files, attachments: [] });
    expect(m.files.map((f) => f.path)).not.toContain("manifest.json");
  });
});
