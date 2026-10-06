/**
 * 완료 패키지 생성기의 시험용 접점. 백업·결재 시험은 "실제로 만들어진 완료 패키지"가 필요하지만 완료 패키지 기능을
 * 직접 import할 수 없으므로(기능 간 import 금지), 합성 루트의 시험 설정(apps/web/server/test-support.ts)이
 * 실제 생성기를 주입한다. 운영 코드에서는 가져오지 않는다.
 */
import type { Db } from "@fmerp/db";
import type { ObjectStorage } from "@fmerp/storage";

export interface PackageGeneratorDeps {
  db: Db;
  authDb: Db;
  storage: ObjectStorage;
  renderPdf: (html: string) => Promise<Uint8Array>;
}

type Generate = (
  deps: PackageGeneratorDeps,
  input: { accountId: string; documentId: string },
) => Promise<unknown>;

let generate: Generate | null = null;

export function setPackageGenerator(fn: Generate): void {
  generate = fn;
}

export function generateCompletedPackage(
  deps: PackageGeneratorDeps,
  input: { accountId: string; documentId: string },
): Promise<unknown> {
  if (!generate)
    throw new Error("완료 패키지 생성기가 주입되지 않았습니다 (apps/web/server/test-support.ts)");
  return generate(deps, input);
}
