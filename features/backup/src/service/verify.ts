// 완료 패키지 무결성 검증 (BAK-003, 색인 재구성·복구 리허설 공용): manifest가 적은 모든 파일과 첨부의 크기·해시가 실제 객체와 같은지 본다.
import type { ObjectStorage } from "@fmerp/storage";

export class PackageVerifyError extends Error {}

interface ManifestJson {
  files: { path: string; size: number; sha256: string }[];
  attachments: { key: string; sha256: string; size: number }[];
}

/** 맞지 않으면 PackageVerifyError(이유 포함). 맞으면 manifest 바이트를 돌려준다 (그 해시가 `document_package.manifest_hash`다) */
export async function verifyPackage(
  storage: ObjectStorage,
  prefix: string,
): Promise<{ manifestBytes: Uint8Array }> {
  const manifestBytes = await storage.getBytes(`${prefix}final/manifest.json`).catch(() => {
    throw new PackageVerifyError("manifest.json이 없습니다");
  });
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as ManifestJson;

  const paths = new Set(manifest.files.map((f) => f.path));
  for (const required of ["approval.json", "document.json", "document.pdf"]) {
    if (!paths.has(required)) throw new PackageVerifyError(`manifest에 ${required}가 없습니다`);
  }
  for (const f of manifest.files) {
    const actual = await storage.hashObject(`${prefix}final/${f.path}`).catch(() => null);
    if (!actual) throw new PackageVerifyError(`패키지 파일이 없습니다: ${f.path}`);
    if (actual.sha256 !== f.sha256 || actual.size !== f.size) {
      throw new PackageVerifyError(`해시가 manifest와 다릅니다: ${f.path}`);
    }
  }
  // 첨부는 복사하지 않고 참조만 하므로 객체가 그대로 있는지 해시로 확인한다
  for (const a of manifest.attachments) {
    const actual = await storage.hashObject(a.key).catch(() => null);
    if (!actual) throw new PackageVerifyError(`첨부 객체가 없습니다: ${a.key}`);
    if (actual.sha256 !== a.sha256)
      throw new PackageVerifyError(`첨부 해시가 manifest와 다릅니다: ${a.key}`);
  }
  return { manifestBytes };
}
