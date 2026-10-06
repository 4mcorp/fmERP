// 완료 패키지 생성 통합 테스트 (실제 DB·S3, PDF 변환은 가짜): BAK-003·004, APV-063, ADR 0009
import { createDatabase, schema, withTenant } from "@fmerp/db";
import { sha256Hex } from "@fmerp/shared/server/hash";
import {
  loadSeedContext,
  type SeedContext,
  seedCompletedDocument,
} from "@fmerp/shared/testing/completed-document";
import { finalKey, ObjectStorage } from "@fmerp/storage";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generatePackage, PackageConflictError } from "../src/service/generate";

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

let seed: SeedContext;
let accountId: string;
let otherAccountId: string;
let businessId: string;
let formVersionId: string;
let members: Record<string, string>;

let pdfCalls = 0;
const renderPdf = async (html: string) => {
  pdfCalls += 1;
  // 만들 때마다 바이트가 달라지는 실제 PDF를 흉내 낸다
  return new TextEncoder().encode(`%PDF-1.7 fake #${pdfCalls} ${html.length}`);
};
const deps = () => ({ db: appDb.db, authDb: authDb.db, storage, renderPdf });

const seedCompleted = (title?: string, values?: Record<string, unknown>) =>
  seedCompletedDocument({ appDb: appDb.db, authDb: authDb.db, storage }, seed, title, values);

const read = async (key: string) => new TextDecoder().decode(await storage.getBytes(key));

beforeAll(async () => {
  seed = await loadSeedContext({ appDb: appDb.db, authDb: authDb.db, storage });
  ({ accountId, otherAccountId, businessId, formVersionId, members } = seed);
});

describe("완료 패키지 생성 (BAK-003, APV-063)", () => {
  it("final/에 4개 파일을 쓰고 manifest의 해시가 실제 내용과 일치한다", async () => {
    const { documentId, prefix } = await seedCompleted();
    const result = await generatePackage(deps(), { accountId, documentId });
    expect(result.alreadyReady).toBe(false);

    const key = (f: Parameters<typeof finalKey>[1]) => finalKey(prefix, f);
    for (const f of ["document.json", "approval.json", "document.pdf", "manifest.json"] as const) {
      expect(await storage.head(key(f)), f).not.toBeNull();
    }
    const manifest = JSON.parse(await read(key("manifest.json"))) as {
      files: { path: string; size: number; sha256: string }[];
    };
    expect(manifest.files.map((f) => f.path)).toEqual([
      "approval.json",
      "document.json",
      "document.pdf",
    ]);
    for (const f of manifest.files) {
      const bytes = await storage.getBytes(key(f.path as Parameters<typeof finalKey>[1]));
      expect(bytes.byteLength).toBe(f.size);
      expect(sha256Hex(bytes)).toBe(f.sha256);
    }
    expect(sha256Hex(await read(key("manifest.json")))).toBe(result.manifestHash);
  });

  it("approval.json에 결재선·처리 이력(IP·의견)·문서번호·상신 해시가 있고 document.json에 입력값이 있다", async () => {
    const { documentId, prefix } = await seedCompleted("내용 확인", { memo: "서울 출장" });
    await generatePackage(deps(), { accountId, documentId });
    const approval = JSON.parse(await read(finalKey(prefix, "approval.json")));
    expect(approval).toMatchObject({
      documentId,
      contentHash: "c".repeat(64),
      status: "COMPLETED",
      drafter: { name: "박사원", department: "재무팀" },
    });
    expect(approval.docNo).toMatch(/^FM-T-2026-\d{4}$/);
    expect(approval.steps[0].assignees[0].name).toBe("최대리");
    expect(approval.actions[0]).toMatchObject({
      actorName: "최대리",
      ip: "203.0.113.5",
      comment: "확인했습니다",
      docHash: "c".repeat(64),
    });
    const doc = JSON.parse(await read(finalKey(prefix, "document.json")));
    expect(doc.values).toEqual({ memo: "서울 출장" });
    expect(doc.form.code).toBe("GENERAL");
    expect(doc.revision.n).toBe(1);
  });

  it("document_package가 READY가 되고 manifest 해시·시각·감사 로그가 남는다", async () => {
    const { documentId } = await seedCompleted();
    const result = await generatePackage(deps(), { accountId, documentId });
    const [pkg] = await withTenant(appDb.db, accountId, (tx) =>
      tx
        .select()
        .from(schema.documentPackage)
        .where(eq(schema.documentPackage.documentId, documentId)),
    );
    expect(pkg).toMatchObject({ status: "READY", manifestHash: result.manifestHash, attempts: 1 });
    expect(pkg?.readyAt).toBeInstanceOf(Date);
    const logs = await withTenant(appDb.db, accountId, (tx) =>
      tx.select().from(schema.auditLog).where(eq(schema.auditLog.targetId, documentId)),
    );
    expect(logs.some((l) => l.action === "document.package_ready" && l.actorUserId === null)).toBe(
      true,
    );
  });

  it("이미 완성된 패키지는 다시 쓰지 않고 PDF도 다시 만들지 않는다", async () => {
    const { documentId } = await seedCompleted();
    const first = await generatePackage(deps(), { accountId, documentId });
    const before = pdfCalls;
    const again = await generatePackage(deps(), { accountId, documentId });
    expect(again).toEqual({ manifestHash: first.manifestHash, alreadyReady: true });
    expect(pdfCalls).toBe(before);
  });
});

describe("재시도와 덮어쓰기 거부 (BAK-004, ADR 0009)", () => {
  it("manifest 전에 중단됐다면 이미 쓴 PDF를 채택해 같은 manifest로 끝낸다", async () => {
    const { documentId, prefix } = await seedCompleted();
    // 중단된 시도를 흉내 낸다: document.pdf만 먼저 있다
    const orphan = new TextEncoder().encode("%PDF-1.7 earlier attempt");
    await storage.putIfAbsent(finalKey(prefix, "document.pdf"), orphan, "application/pdf");
    const before = pdfCalls;
    const result = await generatePackage(deps(), { accountId, documentId });
    expect(pdfCalls).toBe(before); // 다시 렌더하지 않았다
    const manifest = JSON.parse(await read(finalKey(prefix, "manifest.json")));
    expect(manifest.files.find((f: { path: string }) => f.path === "document.pdf").sha256).toBe(
      sha256Hex(orphan),
    );
    expect(result.alreadyReady).toBe(false);
  });

  it("이미 있는 JSON의 내용이 다르면 FAILED로 두고 덮어쓰지 않는다", async () => {
    const bad = await seedCompleted();
    const tampered = new TextEncoder().encode('{"tampered":true}\n');
    await storage.putIfAbsent(finalKey(bad.prefix, "approval.json"), tampered, "application/json");
    await expect(
      generatePackage(deps(), { accountId, documentId: bad.documentId }),
    ).rejects.toBeInstanceOf(PackageConflictError);
    // 덮어쓰지 않았다
    expect(await read(finalKey(bad.prefix, "approval.json"))).toBe('{"tampered":true}\n');
    expect(await storage.head(finalKey(bad.prefix, "manifest.json"))).toBeNull();
    const [pkg] = await withTenant(appDb.db, accountId, (tx) =>
      tx
        .select()
        .from(schema.documentPackage)
        .where(eq(schema.documentPackage.documentId, bad.documentId)),
    );
    expect(pkg).toMatchObject({ status: "FAILED" });
    expect(pkg?.lastError).toMatch(/덮어쓰지 않음/);
  });

  it("S3 오류 같은 일시 실패는 PENDING으로 두고 시도 횟수와 오류를 기록해 다시 시도할 수 있다", async () => {
    const { documentId } = await seedCompleted();
    const failing = {
      ...deps(),
      renderPdf: async () => {
        throw new Error("브라우저가 응답하지 않습니다");
      },
    };
    await expect(generatePackage(failing, { accountId, documentId })).rejects.toThrow("브라우저");
    const [pkg] = await withTenant(appDb.db, accountId, (tx) =>
      tx
        .select()
        .from(schema.documentPackage)
        .where(eq(schema.documentPackage.documentId, documentId)),
    );
    expect(pkg).toMatchObject({ status: "PENDING", attempts: 1 });
    expect(pkg?.lastError).toContain("브라우저");
    // 다시 시도하면 완성된다
    const retry = await generatePackage(deps(), { accountId, documentId });
    expect(retry.alreadyReady).toBe(false);
    const [done] = await withTenant(appDb.db, accountId, (tx) =>
      tx
        .select()
        .from(schema.documentPackage)
        .where(eq(schema.documentPackage.documentId, documentId)),
    );
    expect(done).toMatchObject({ status: "READY", attempts: 2, lastError: null });
  });

  it("완료되지 않은 문서와 다른 계정의 문서는 만들 수 없다", async () => {
    const { documentId } = await seedCompleted();
    await expect(
      generatePackage(deps(), { accountId: otherAccountId, documentId }),
    ).rejects.toThrow();
    const draft = crypto.randomUUID();
    await withTenant(appDb.db, accountId, (tx) =>
      tx.execute(sql`insert into document (id, account_id, business_id, drafter_membership_id, title, status, policy, form_version_id)
        values (${draft}::uuid, ${accountId}::uuid, ${businessId}::uuid, ${members["member1@example.com"]}::uuid, '초안', 'DRAFT',
        '{"disagree":"reject","rejectTo":"drafter","auditCanReject":true}'::jsonb, ${formVersionId}::uuid)`),
    );
    await expect(generatePackage(deps(), { accountId, documentId: draft })).rejects.toThrow(
      /완료된 문서가 아닙니다/,
    );
  });
});
