/**
 * 완료 패키지(S3 `final/`)의 JSON 내용을 만드는 순수 함수 (PRD BAK-003, ADR 0009).
 * 같은 입력이면 언제나 같은 바이트가 나와야 한다(재시도할 때 이미 쓴 객체와 해시로 비교한다).
 * 시각은 DB 값을 ISO 문자열로 바꿔 넘기며, 이 모듈이 현재 시각을 읽지 않는다. 해시도 호출하는 쪽이 계산해 넘긴다
 * (이 패키지는 Node 모듈을 쓰지 않는다).
 */

export const PACKAGE_SCHEMA_VERSION = 1;

/** 키를 정렬하고 2칸 들여쓴 JSON. undefined는 뺀다. 끝에 줄바꿈 한 개 */
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .filter(([, x]) => x !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, x]) => [k, sort(x)]),
      );
    }
    return v;
  };
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

export interface PersonCard {
  membershipId: string;
  name: string;
  department?: string | null;
  position?: string | null;
}

export interface AttachmentRef {
  id: string;
  filename: string;
  /** S3 키 (첨부는 복사하지 않고 참조한다) */
  key: string;
  size: number;
  sha256: string;
  mime: string;
}

export interface RecordStep {
  id: string;
  seq: number;
  type: string;
  status: string;
  quorum: number | null;
  canFinalize: boolean;
  assignees: PersonCard[];
}

export interface RecordAction {
  stepId: string;
  actorMembershipId: string;
  actorName: string;
  onBehalfOfMembershipId: string | null;
  onBehalfOfName: string | null;
  action: string;
  comment: string | null;
  ip: string | null;
  /** ISO 시각 */
  at: string;
  docHash: string | null;
}

export interface ApprovalRecordInput {
  documentId: string;
  docNo: string | null;
  title: string;
  contentHash: string | null;
  securityLevel: string;
  status: string;
  submittedAt: string | null;
  completedAt: string | null;
  drafter: PersonCard;
  steps: RecordStep[];
  actions: RecordAction[];
  attachments: AttachmentRef[];
}

/** `approval.json`: 결재선, 단계별 처리자·대결 여부·일시·IP·의견, 문서번호, 상신 해시, 파일별 SHA-256 */
export function buildApprovalJson(input: ApprovalRecordInput) {
  const actions = [...input.actions].sort(
    (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0) || (a.stepId < b.stepId ? -1 : 1),
  );
  return {
    schemaVersion: PACKAGE_SCHEMA_VERSION,
    documentId: input.documentId,
    docNo: input.docNo,
    title: input.title,
    contentHash: input.contentHash,
    securityLevel: input.securityLevel,
    status: input.status,
    submittedAt: input.submittedAt,
    completedAt: input.completedAt,
    drafter: input.drafter,
    steps: [...input.steps].sort((a, b) => a.seq - b.seq || (a.id < b.id ? -1 : 1)),
    actions,
    /** 완료 시점에 후결 대기였던 단계. 이후의 후결 승인은 post-approvals/에 따로 기록된다 */
    pendingPostSteps: input.steps.filter((s) => s.status === "POST_PENDING").map((s) => s.id),
    attachments: [...input.attachments].sort((a, b) => (a.id < b.id ? -1 : 1)),
  };
}

export interface DocumentJsonInput {
  documentId: string;
  docNo: string | null;
  title: string;
  businessCode: string;
  securityLevel: string;
  urgent: boolean;
  desiredDueDate: string | null;
  submittedAt: string | null;
  form: { code: string; name: string; version: number; schema: unknown };
  values: Record<string, unknown>;
  revision: { n: number; key: string; sha256: string };
}

/** `document.json`: 작성 당시 양식 버전의 스키마와 입력값 원본 */
export function buildDocumentJson(input: DocumentJsonInput) {
  return { schemaVersion: PACKAGE_SCHEMA_VERSION, ...input };
}

export interface ManifestFileInput {
  path: string;
  size: number;
  sha256: string;
}

/** `manifest.json`: 패키지 안 파일의 경로·크기·SHA-256과 첨부 참조. 자기 자신은 목록에 넣지 않는다 */
export function buildManifest(input: {
  documentId: string;
  files: ManifestFileInput[];
  attachments: AttachmentRef[];
}) {
  return {
    schemaVersion: PACKAGE_SCHEMA_VERSION,
    documentId: input.documentId,
    files: input.files
      .map((f) => ({ path: f.path, size: f.size, sha256: f.sha256 }))
      .sort((a, b) => (a.path < b.path ? -1 : 1)),
    attachments: [...input.attachments]
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((a) => ({
        key: a.key,
        filename: a.filename,
        size: a.size,
        sha256: a.sha256,
        mime: a.mime,
      })),
  };
}
