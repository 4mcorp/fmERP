// 문서 관련 S3 키 규칙 (DEPLOYMENT_PLAN 2.1, ADR 0008·0009)

const kstYear = (date: Date) => new Date(date.getTime() + 9 * 3_600_000).getUTCFullYear();

/** `docs/{계정}/{사업자코드}/{YYYY}/{문서ID}/` — 연도는 문서를 만든 해(서울 시간) */
export function docPrefix(
  accountId: string,
  businessCode: string,
  createdAt: Date,
  documentId: string,
): string {
  return `docs/${accountId}/${businessCode}/${kstYear(createdAt)}/${documentId}/`;
}

export const revisionKey = (prefix: string, n: number) => `${prefix}revisions/${n}.json`;

export const attachmentKey = (prefix: string, attachmentId: string, fileName: string) =>
  `${prefix}attachments/${attachmentId}_${fileName}`;

/** 완료 패키지(결재 완료 시 한 번만 쓴다). 파일 이름은 `document.pdf`·`document.json`·`approval.json`·`manifest.json` */
export const FINAL_FILES = [
  "document.json",
  "approval.json",
  "document.pdf",
  "manifest.json",
] as const;
export type FinalFile = (typeof FINAL_FILES)[number];
export const finalKey = (prefix: string, file: FinalFile) => `${prefix}final/${file}`;

/** 완료 이후의 후결 승인 기록 (건별 한 번만 쓴다) */
export const postApprovalKey = (prefix: string, stepId: string) =>
  `${prefix}post-approvals/${stepId}.json`;

/** 업로드 직후 검증 전 객체가 놓이는 곳. 등록되지 않으면 버킷 수명 주기 규칙이 지운다 */
export const stagingPrefix = (accountId: string) => `_staging/${accountId}/`;
export const stagingKey = (accountId: string, uploadId: string) =>
  `${stagingPrefix(accountId)}${uploadId}`;
