// 문서 관련 S3 키 규칙 (DEPLOYMENT_PLAN 2.1, ADR 0008)

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

/** 업로드 직후 검증 전 객체가 놓이는 곳. 등록되지 않으면 버킷 수명 주기 규칙이 지운다 */
export const stagingPrefix = (accountId: string) => `_staging/${accountId}/`;
export const stagingKey = (accountId: string, uploadId: string) =>
  `${stagingPrefix(accountId)}${uploadId}`;
