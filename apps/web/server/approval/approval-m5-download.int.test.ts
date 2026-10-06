// M5-B3 통합 테스트: 완료 PDF·패키지 다운로드 (BAK-008), 열람 권한·재인증·감사 로그 (실제 DB·S3)
import { generatePackage } from "@fmerp/completion";
import {
  loadSeedContext,
  type SeedContext,
  seedCompletedDocument,
} from "@fmerp/completion/test-support";
import { createDatabase, schema, withTenant } from "@fmerp/db";
import { json, loginAs, type TestClient } from "@fmerp/shared/testing/test-client";
import { ObjectStorage } from "@fmerp/storage";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const appDb = createDatabase(process.env.DATABASE_URL ?? "");
const authDb = createDatabase(process.env.AUTH_DATABASE_URL ?? "");
const storage = new ObjectStorage({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? "us-east-1",
  bucket: process.env.S3_BUCKET ?? "",
  accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
  forcePathStyle: true,
});
afterAll(async () => {
  await appDb.pool.end();
  await authDb.pool.end();
});

const env = { appDb: appDb.db, authDb: authDb.db, storage };
const renderPdf = async () => new TextEncoder().encode("%PDF-1.7 download test");
const genDeps = { db: appDb.db, authDb: authDb.db, storage, renderPdf };
let ctx: SeedContext;
const clients: Record<string, TestClient> = {};
const req = (who: string, path: string) => (clients[who] as TestClient).request(path);

async function setPin(who: string) {
  await (clients[who] as TestClient).request("/api/me/pin", {
    method: "PUT",
    body: { pin: "246810" },
  });
  const res = await (clients[who] as TestClient).request("/api/me/pin/verify", {
    method: "POST",
    body: { pin: "246810" },
  });
  expect(res.status).toBe(200);
}

/** 완료 문서를 만들고 첨부 한 건을 붙인 뒤(초안일 때만 가능해서 시드 전에 넣을 수 없다) 패키지를 생성한다 */
async function readyDocument(withPackage = true) {
  const { documentId, prefix } = await seedCompletedDocument(env, ctx, "다운로드 시험", undefined, {
    attachment: { filename: "영수증.txt", bytes: new TextEncoder().encode("영수증 내용") },
  });
  if (withPackage) {
    await generatePackage(
      { ...env, db: appDb.db, renderPdf },
      { accountId: ctx.accountId, documentId },
    );
  }
  return { documentId, prefix };
}

beforeAll(async () => {
  ctx = await loadSeedContext(env);
  for (const who of ["member1", "member2", "hr", "owner", "admin", "owner-b"]) {
    clients[who] = await loginAs(`${who}@example.com`);
  }
  await setPin("member1");
});

describe("패키지 상태 (APV-063)", () => {
  it("패키지가 아직 없으면 PENDING, 만들어지면 READY다", async () => {
    const { documentId } = await readyDocument(false);
    expect(
      (await json<{ status: string }>(await req("member1", `/api/approvals/${documentId}/package`)))
        .status,
    ).toBe("PENDING");
    await generatePackage(genDeps, { accountId: ctx.accountId, documentId });
    const ready = await json<{ status: string; readyAt: string }>(
      await req("member1", `/api/approvals/${documentId}/package`),
    );
    expect(ready.status).toBe("READY");
    expect(ready.readyAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("열람 권한이 없으면 문서가 있는지도 알려 주지 않는다", async () => {
    const { documentId } = await readyDocument();
    for (const who of ["hr", "admin", "owner-b"]) {
      expect((await req(who, `/api/approvals/${documentId}/package`)).status, who).toBe(404);
    }
  });
});

describe("PDF 다운로드 (BAK-008)", () => {
  it("열람 권한자는 서명 URL로 PDF를 받고 다운로드가 감사 로그에 남는다", async () => {
    const { documentId } = await readyDocument();
    const res = await req("member1", `/api/approvals/${documentId}/package/pdf`);
    expect(res.status).toBe(200);
    const { url, filename } = await json<{ url: string; filename: string }>(res);
    expect(filename).toMatch(/^FM-T-2026-\d{4}\.pdf$/);
    const file = await fetch(url);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-disposition")).toContain("UTF-8''");
    expect(new TextDecoder().decode(await file.arrayBuffer())).toBe("%PDF-1.7 download test");
    const logs = await withTenant(appDb.db, ctx.accountId, (tx) =>
      tx.select().from(schema.auditLog).where(eq(schema.auditLog.targetId, documentId)),
    );
    expect(logs.some((l) => l.action === "document.download_pdf")).toBe(true);
  });

  it("감사 범위(read_all)의 소유자는 받을 수 있고, 관계없는 사람은 404다", async () => {
    const { documentId } = await readyDocument();
    expect((await req("owner", `/api/approvals/${documentId}/package/pdf`)).status).toBe(200);
    for (const who of ["hr", "admin", "owner-b"]) {
      expect((await req(who, `/api/approvals/${documentId}/package/pdf`)).status, who).toBe(404);
    }
  });

  it("패키지가 아직 없으면 409로 알려 준다", async () => {
    const { documentId } = await readyDocument(false);
    const res = await req("member1", `/api/approvals/${documentId}/package/pdf`);
    expect(res.status).toBe(409);
  });
});

describe("패키지 ZIP 다운로드 (BAK-008)", () => {
  it("PIN 재인증이 없는 새 세션은 428이다", async () => {
    const { documentId } = await readyDocument();
    // 재인증(PIN 확인 시각)은 세션마다 따로다. 새로 로그인한 세션은 아직 확인하지 않았다
    const fresh = await loginAs("member1@example.com");
    expect((await fresh.request(`/api/approvals/${documentId}/package/zip`)).status).toBe(428);
  });

  it("재인증한 열람 권한자는 final/ 4개 파일이 든 ZIP을 받고 감사 로그가 남는다", async () => {
    const { documentId } = await readyDocument();
    const res = await req("member1", `/api/approvals/${documentId}/package/zip`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    const bytes = new Uint8Array(await res.arrayBuffer());
    // ZIP 시그니처와 파일 이름(헤더에 그대로 들어 있다)
    expect(String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0)).toBe("PK");
    const text = Buffer.from(bytes).toString("latin1");
    expect(text).toContain("attachments/");
    for (const name of [
      "final/document.json",
      "final/approval.json",
      "final/document.pdf",
      "final/manifest.json",
    ]) {
      expect(text, name).toContain(name);
    }
    const logs = await withTenant(appDb.db, ctx.accountId, (tx) =>
      tx.select().from(schema.auditLog).where(eq(schema.auditLog.targetId, documentId)),
    );
    expect(logs.some((l) => l.action === "document.download_package")).toBe(true);
  });

  it("결재선 참여자도 재인증하면 받을 수 있다", async () => {
    const { documentId } = await readyDocument();
    await setPin("member2");
    expect((await req("member2", `/api/approvals/${documentId}/package/zip`)).status).toBe(200);
  });

  it("재인증을 마친 사람이라도 열람 권한이 없으면 404다", async () => {
    const { documentId } = await readyDocument();
    await setPin("hr");
    expect((await req("hr", `/api/approvals/${documentId}/package/zip`)).status).toBe(404);
  });
});
