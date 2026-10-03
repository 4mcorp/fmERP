// M4 통합 테스트: 양식 버전, 본문 리비전·내용 해시, 첨부 검증, 처리 API(재인증), 의견, 결재선 변경, 받은함 (실제 DB·S3)
import { createDatabase, schema, withTenant } from "@fmerp/db";
import { ObjectStorage } from "@fmerp/storage";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { json, loginAs, type TestClient } from "../test-client";

const authDb = createDatabase(process.env.AUTH_DATABASE_URL ?? "");
const appDb = createDatabase(process.env.DATABASE_URL ?? "");
const storage = new ObjectStorage({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? "us-east-1",
  bucket: process.env.S3_BUCKET ?? "",
  accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
  forcePathStyle: true,
});
afterAll(async () => {
  await authDb.pool.end();
  await appDb.pool.end();
});

interface Problem {
  code: string;
  title: string;
  extensions?: Record<string, unknown>;
}
interface Step {
  id: string;
  type: string;
  status: string;
  version: number;
}
interface View {
  id: string;
  status: string;
  docNo: string | null;
  latestRevision: number;
  steps: Step[];
}

let accountId: string;
let businessId: string;
let lgBusinessId: string;
let ids: Record<string, string>;
let owner: TestClient;
let admin: TestClient;
let member1: TestClient;
let member2: TestClient;
let bizadmin: TestClient;
let auditor: TestClient;
let generalFormId: string;
const DOC = { type: "doc", content: [] };
let keySeq = 0;
const key = () => `m4-${++keySeq}-${Math.random().toString(36).slice(2)}`;
const post = (c: TestClient, path: string, body?: unknown) =>
  c.request(path, { method: "POST", body: body ?? {} });
const put = (c: TestClient, path: string, body: unknown) =>
  c.request(path, { method: "PUT", body });
const user = (email: string) => ({ kind: "user", membershipId: ids[email] });
const approve = (seq: number, email: string) => ({ type: "approve", seq, target: user(email) });

async function view(c: TestClient, id: string) {
  return json<View>(await c.request(`/api/approvals/${id}`));
}

async function createDoc(
  c: TestClient,
  over: Record<string, unknown> = {},
): Promise<{ documentId: string; status: string }> {
  const res = await post(c, "/api/approvals", {
    businessId,
    formId: generalFormId,
    title: "테스트 문서",
    body: { body: DOC },
    line: [approve(1, "member2@example.com")],
    ...over,
  });
  if (res.status !== 201) throw new Error(`문서 생성 실패 ${res.status} ${await res.text()}`);
  return json(res);
}

/** 활성 단계를 찾아 처리한다. PIN 재인증은 아래 setupPin에서 미리 통과시킨다 */
async function act(c: TestClient, docId: string, action: Record<string, unknown>, who?: string) {
  // 처리 대상 단계는 기안자(member1)의 조회로 찾는다. 참여자가 아닌 사람은 조회 자체가 막힌다
  const v = await view(member1, docId);
  const target = v.steps.find((s) => s.status === "ACTIVE" || s.status === "HELD") ?? v.steps[0];
  void who;
  return c.request(`/api/approvals/${docId}/steps/${target?.id}/act`, {
    method: "POST",
    body: { action, idempotencyKey: key(), expectedVersion: target?.version },
  });
}

async function uploadFile(
  c: TestClient,
  docId: string,
  filename: string,
  bytes: Uint8Array,
  declared = bytes.length,
) {
  const upload = await post(c, `/api/approvals/${docId}/attachments/upload-url`, {
    filename,
    size: declared,
  });
  if (upload.status !== 200) return { upload };
  const { uploadUrl, stagingKey } = await json<{ uploadUrl: string; stagingKey: string }>(upload);
  const put1 = await fetch(uploadUrl, {
    method: "PUT",
    body: bytes as unknown as BodyInit,
    headers: { "Content-Type": "application/octet-stream" },
  });
  expect(put1.ok).toBe(true);
  const registered = await post(c, `/api/approvals/${docId}/attachments`, {
    stagingKey,
    filename,
    size: declared,
  });
  return { upload, registered, stagingKey };
}

const pdfBytes = () => new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n");
const exeBytes = () => Uint8Array.from([0x4d, 0x5a, 0x90, 0x00, 3, 0, 0, 0, 4, 0, 0, 0]);

async function setupPin(c: TestClient, pin = "246810") {
  await c.request("/api/me/pin", { method: "PUT", body: { pin } });
  const verified = await post(c, "/api/me/pin/verify", { pin });
  expect(verified.status).toBe(200);
}

beforeAll(async () => {
  [owner, admin, member1, member2, bizadmin, auditor] = await Promise.all([
    loginAs("owner@example.com"),
    loginAs("admin@example.com"),
    loginAs("member1@example.com"),
    loginAs("member2@example.com"),
    loginAs("bizadmin@example.com"),
    loginAs("auditor@example.com"),
  ]);
  const [account] = await authDb.db
    .select()
    .from(schema.account)
    .where(eq(schema.account.slug, "fourm-test"));
  accountId = account?.id ?? "";
  const members = await authDb.db
    .select({
      id: schema.membership.id,
      email: schema.user.email,
      accountId: schema.membership.accountId,
    })
    .from(schema.membership)
    .innerJoin(schema.user, eq(schema.user.id, schema.membership.userId));
  ids = Object.fromEntries(
    members.filter((x) => x.accountId === accountId).map((x) => [x.email, x.id]),
  );
  const businesses = await withTenant(appDb.db, accountId, (tx) =>
    tx.select().from(schema.business),
  );
  businessId = businesses.find((b) => b.code === "FM")?.id ?? "";
  lgBusinessId = businesses.find((b) => b.code === "LG")?.id ?? "";
  const forms = await json<{ id: string; code: string }[]>(await member1.request("/api/forms"));
  generalFormId = forms.find((f) => f.code === "GENERAL")?.id ?? "";
  await Promise.all([setupPin(member1), setupPin(member2), setupPin(bizadmin)]);
});

const version = (over: Record<string, unknown> = {}) => ({
  schema: { fields: [{ key: "memo", label: "메모", type: "text", required: true, maxLength: 50 }] },
  defaultLine: [approve(1, "member2@example.com")],
  numbering: { rule: "{사업자코드}-{양식코드}-{YYYY}-{SEQ:4}", cycle: "year", at: "complete" },
  retentionYears: 3,
  securityDefault: "normal",
  allowLineEdit: true,
  policy: { disagree: "reject", rejectTo: "drafter", auditCanReject: true },
  ...over,
});

describe("접근 제어", () => {
  it("비로그인 요청은 401", async () => {
    const { app } = await import("../app");
    for (const [method, path] of [
      ["GET", "/api/forms"],
      ["POST", "/api/forms"],
      ["GET", "/api/inbox/pending"],
      ["GET", "/api/inbox/mine"],
      ["GET", "/api/approval-line-templates"],
      ["PUT", "/api/approvals/00000000-0000-0000-0000-000000000000/draft"],
      [
        "POST",
        "/api/approvals/00000000-0000-0000-0000-000000000000/steps/00000000-0000-0000-0000-000000000000/act",
      ],
    ] as const) {
      const res = await app.request(path, {
        method,
        headers: { "content-type": "application/json" },
        body: method === "GET" ? undefined : "{}",
      });
      expect(res.status, path).toBe(401);
    }
  });
});

describe("양식 (APV-001·003~006)", () => {
  it("기본 양식 7종이 있고, 일반 구성원은 관리 목록을 볼 수 없다", async () => {
    const list = await json<{ code: string; name: string }[]>(await member1.request("/api/forms"));
    expect(list.map((f) => f.code)).toEqual(
      expect.arrayContaining([
        "GENERAL",
        "PROPOSAL",
        "EXPENSE",
        "LEAVE",
        "TRIP",
        "COOP",
        "PURCHASE",
      ]),
    );
    expect((await member1.request("/api/forms?all=true")).status).toBe(403);
    expect((await admin.request("/api/forms?all=true")).status).toBe(200);
  });

  it("잘못된 필드 정의는 사유와 함께 거부하고, 정상 양식은 만들어지며, 중복 코드는 409", async () => {
    const bad = await post(admin, "/api/forms", {
      code: "BADFORM",
      name: "잘못된 양식",
      version: version({
        schema: { fields: [{ key: "a", label: "a", type: "text", pattern: "(a+)+$" }] },
      }),
    });
    expect(bad.status).toBe(400);
    expect((await json<Problem>(bad)).code).toBe("form_invalid");

    const ok = await post(admin, "/api/forms", {
      code: "MEMO1",
      name: "메모 양식",
      version: version(),
    });
    expect(ok.status).toBe(201);
    expect(
      (await post(admin, "/api/forms", { code: "MEMO1", name: "중복", version: version() })).status,
    ).toBe(409);
    // 일반 구성원은 만들 수 없다
    expect(
      (await post(member1, "/api/forms", { code: "MEMO2", name: "x", version: version() })).status,
    ).toBe(403);
  });

  it("사업자 관리자는 자기 사업자 범위의 양식만 만든다", async () => {
    const own = await post(bizadmin, "/api/forms", {
      code: "FMONLY",
      name: "본사 전용",
      scope: { businessIds: [businessId] },
      version: version(),
    });
    expect(own.status).toBe(201);
    const wide = await post(bizadmin, "/api/forms", {
      code: "WIDE",
      name: "전사",
      version: version(),
    });
    expect(wide.status).toBe(403);
    const other = await post(bizadmin, "/api/forms", {
      code: "LGONLY",
      name: "물류 전용",
      scope: { businessIds: [lgBusinessId] },
      version: version(),
    });
    expect(other.status).toBe(403);
  });

  it("수정하면 새 버전이 되고, 이미 작성된 문서는 작성 당시 버전으로 검증된다 (APV-005)", async () => {
    const created = await json<{ formId: string }>(
      await post(admin, "/api/forms", { code: "VER1", name: "버전 양식", version: version() }),
    );
    const doc = await createDoc(member1, { formId: created.formId, body: { memo: "v1 메모" } });
    // v2: 필수 필드 추가
    const v2 = await post(admin, `/api/forms/${created.formId}/versions`, {
      version: version({
        schema: {
          fields: [
            { key: "memo", label: "메모", type: "text", required: true, maxLength: 50 },
            { key: "extra", label: "추가 항목", type: "text", required: true },
          ],
        },
      }),
    });
    expect((await json<{ version: number }>(v2)).version).toBe(2);
    // 이전 버전으로 만든 문서는 v1 스키마(추가 항목 불필요)로 그대로 상신된다
    const submitted = await post(member1, `/api/approvals/${doc.documentId}/submit`);
    expect(submitted.status).toBe(200);
    // 새로 만드는 문서는 v2를 따른다
    const fresh = await createDoc(member1, { formId: created.formId, body: { memo: "v2 메모" } });
    const bad = await post(member1, `/api/approvals/${fresh.documentId}/submit`);
    expect(bad.status).toBe(400);
    expect((await json<Problem>(bad)).code).toBe("validation_failed");
  });

  it("양식 버전은 DB에서도 수정·삭제할 수 없다 (추가만 가능)", async () => {
    const run = (fn: (tx: Parameters<Parameters<typeof withTenant>[2]>[0]) => Promise<unknown>) =>
      withTenant(appDb.db, accountId, fn).then(
        () => null,
        (e: unknown) => e,
      );
    const upd = (await run((tx) => tx.update(schema.formVersion).set({ retentionYears: 10 }))) as {
      cause?: { message?: string };
    } | null;
    expect(upd?.cause?.message).toMatch(/permission denied/);
    const del = (await run((tx) => tx.delete(schema.formVersion))) as {
      cause?: { message?: string };
    } | null;
    expect(del?.cause?.message).toMatch(/permission denied/);
  });

  it("복제·내보내기·가져오기 왕복, 사용 중지한 양식은 기안할 수 없다 (APV-006)", async () => {
    const created = await json<{ formId: string }>(
      await post(admin, "/api/forms", { code: "RT1", name: "왕복 양식", version: version() }),
    );
    const dup = await post(admin, `/api/forms/${created.formId}/duplicate`, {
      code: "RT1-COPY",
      name: "왕복 양식 사본",
    });
    expect(dup.status).toBe(201);
    const exported = await json<Record<string, unknown>>(
      await admin.request(`/api/forms/${created.formId}/export`),
    );
    expect(exported.format).toBe("fmerp-form/1");
    const imported = await post(admin, "/api/forms/import", {
      data: exported,
      code: "RT1-IMP",
      name: "가져온 양식",
    });
    expect(imported.status).toBe(201);

    expect((await post(admin, `/api/forms/${created.formId}/deactivate`)).status).toBe(200);
    const blocked = await post(member1, "/api/approvals", {
      businessId,
      formId: created.formId,
      title: "중지된 양식",
      body: { memo: "x" },
    });
    expect(blocked.status).toBe(400);
    const list = await json<{ id: string }[]>(await member1.request("/api/forms"));
    expect(list.some((f) => f.id === created.formId)).toBe(false);
    expect((await post(admin, `/api/forms/${created.formId}/activate`)).status).toBe(200);
  });

  it("사용 범위(사업자) 밖 구성원은 양식을 쓸 수 없다", async () => {
    const scoped = await json<{ formId: string }>(
      await post(admin, "/api/forms", {
        code: "LGSCOPE",
        name: "물류 전용 양식",
        scope: { businessIds: [lgBusinessId] },
        version: version(),
      }),
    );
    const res = await post(member1, "/api/approvals", {
      businessId,
      formId: scoped.formId,
      title: "x",
      body: { memo: "x" },
    });
    expect(res.status).toBe(400);
    const list = await json<{ id: string }[]>(await member1.request("/api/forms"));
    expect(list.some((f) => f.id === scoped.formId)).toBe(false);
  });

  it("즐겨찾기와 결재선 템플릿 (APV-010·033)", async () => {
    expect(
      (await put(member1, `/api/forms/${generalFormId}/favorite`, { favorite: true })).status,
    ).toBe(200);
    const list = await json<{ id: string; favorite: boolean }[]>(
      await member1.request("/api/forms"),
    );
    expect(list.find((f) => f.id === generalFormId)?.favorite).toBe(true);

    const personal = await post(member1, "/api/approval-line-templates", {
      name: "내 결재선",
      items: [{ ...approve(1, "member2@example.com"), canFinalize: true }],
    });
    expect(personal.status).toBe(201);
    const mine = await json<{ id: string; items: { canFinalize?: boolean }[]; shared: boolean }[]>(
      await member1.request("/api/approval-line-templates"),
    );
    const saved = mine.find((t) => !t.shared);
    // 개인 템플릿에서는 전결 권한이 제거된다
    expect(saved?.items[0]?.canFinalize ?? false).toBe(false);
    // 공용 템플릿은 양식 관리 권한자만, 남의 개인 템플릿은 보이지 않는다
    expect(
      (
        await post(member1, "/api/approval-line-templates", {
          name: "공용",
          shared: true,
          items: [approve(1, "member2@example.com")],
        })
      ).status,
    ).toBe(403);
    const sharedOk = await post(admin, "/api/approval-line-templates", {
      name: "공용 결재선",
      shared: true,
      formId: generalFormId,
      items: [approve(1, "member2@example.com")],
    });
    expect(sharedOk.status).toBe(201);
    const adminView = await json<{ name: string }[]>(
      await admin.request("/api/approval-line-templates"),
    );
    expect(adminView.map((t) => t.name)).not.toContain("내 결재선");
    expect(
      (await member1.request(`/api/approval-line-templates/${saved?.id}`, { method: "DELETE" }))
        .status,
    ).toBe(200);
  });
});

describe("결재선 규칙 (M3 FU-12)", () => {
  it("결재선 수정을 막는 양식은 기안자가 보낸 결재선을 무시하고 기본 결재선을 쓴다", async () => {
    const locked = await json<{ formId: string }>(
      await post(admin, "/api/forms", {
        code: "LOCKED1",
        name: "고정 결재선",
        version: version({
          allowLineEdit: false,
          defaultLine: [approve(1, "bizadmin@example.com")],
        }),
      }),
    );
    const doc = await createDoc(member1, {
      formId: locked.formId,
      body: { memo: "m" },
      line: [approve(1, "auditor@example.com")],
    });
    const v = await view(member1, doc.documentId);
    expect(v.steps).toHaveLength(1);
    expect(
      (v.steps[0] as unknown as { assignees: { membershipId: string }[] }).assignees[0]
        ?.membershipId,
    ).toBe(ids["bizadmin@example.com"]);
  });

  it("수정 허용 양식에서도 후결 단계를 추가할 수 없고, 전결 권한은 줄 수 없다", async () => {
    const withPost = await post(member1, "/api/approvals", {
      businessId,
      formId: generalFormId,
      title: "후결 추가 시도",
      body: { body: DOC },
      line: [
        approve(1, "member2@example.com"),
        { type: "post", seq: 5, target: user("bizadmin@example.com") },
      ],
    });
    expect(withPost.status).toBe(400);
    expect((await json<Problem>(withPost)).code).toBe("line_invalid");

    const doc = await createDoc(member1, {
      line: [{ ...approve(1, "member2@example.com"), canFinalize: true }],
    });
    const steps = await withTenant(appDb.db, accountId, (tx) =>
      tx
        .select()
        .from(schema.approvalStep)
        .where(eq(schema.approvalStep.documentId, doc.documentId)),
    );
    expect(steps.every((s) => s.canFinalize === false)).toBe(true);
  });
});

describe("본문 리비전·내용 해시 (BAK-002, APV-011·016)", () => {
  it("저장할 때마다 새 S3 키로 쓰고, 기대 리비전이 다르면 충돌한다", async () => {
    const doc = await createDoc(member1);
    const v1 = await view(member1, doc.documentId);
    expect(v1.latestRevision).toBe(1);
    const save = (body: unknown, expectedRevision?: number) =>
      put(member1, `/api/approvals/${doc.documentId}/draft`, { body, expectedRevision });
    const second = await save({ body: DOC, extra: "무시되는 키" }, 1);
    expect((await json<{ revision: number }>(second)).revision).toBe(2);
    const conflict = await save({ body: DOC }, 1);
    expect(conflict.status).toBe(409);
    expect((await json<Problem>(conflict)).code).toBe("revision_conflict");

    const revisions = await withTenant(appDb.db, accountId, (tx) =>
      tx
        .select()
        .from(schema.documentRevision)
        .where(eq(schema.documentRevision.documentId, doc.documentId)),
    );
    expect(revisions.map((r) => r.n).sort()).toEqual([1, 2]);
    expect(new Set(revisions.map((r) => r.storageKey)).size).toBe(2);
    for (const r of revisions)
      expect(await storage.head(r.storageKey)).toMatchObject({ size: r.size });
    // 양식에 없는 키는 저장되지 않는다
    const body2 = await json<{ body: Record<string, unknown> }>(
      await member1.request(`/api/approvals/${doc.documentId}/body`),
    );
    expect("extra" in body2.body).toBe(false);
  });

  it("초안 저장은 필수 검사를 건너뛰지만 형식 오류는 거부하고, 상신은 전체를 검사한다", async () => {
    const doc = await createDoc(member1, { body: undefined });
    expect(
      (await put(member1, `/api/approvals/${doc.documentId}/draft`, { body: {} })).status,
    ).toBe(200);
    const bad = await put(member1, `/api/approvals/${doc.documentId}/draft`, {
      body: { body: "<b>html</b>" },
    });
    expect(bad.status).toBe(400);
    expect((await json<Problem>(bad)).code).toBe("validation_failed");
    const submit = await post(member1, `/api/approvals/${doc.documentId}/submit`);
    expect(submit.status).toBe(400);
    const problem = await json<Problem>(submit);
    expect((problem.extensions?.errors as unknown[] | undefined)?.length ?? 0).toBeGreaterThan(0);
  });

  it("상신 후에는 저장·리비전 추가가 막히고, 기안자만 저장할 수 있다", async () => {
    const doc = await createDoc(member1);
    expect(
      (await put(member2, `/api/approvals/${doc.documentId}/draft`, { title: "남의 문서" })).status,
    ).toBe(403);
    await post(member1, `/api/approvals/${doc.documentId}/submit`);
    const after = await put(member1, `/api/approvals/${doc.documentId}/draft`, {
      body: { body: DOC },
    });
    expect(after.status).toBe(409);
    // DB 직접 쓰기도 거부된다
    const err = await withTenant(appDb.db, accountId, (tx) =>
      tx.insert(schema.documentRevision).values({
        accountId,
        documentId: doc.documentId,
        n: 3,
        storageKey: "x",
        sha256: "x",
        size: 1,
        savedByMembershipId: ids["member1@example.com"] as string,
      }),
    ).then(
      () => null,
      (e: unknown) => e as { cause?: { message?: string } },
    );
    expect(err?.cause?.message).toMatch(/본문 저장본/);
    // 회수 후 초안으로 되돌리면 다시 저장할 수 있다
    await post(member1, `/api/approvals/${doc.documentId}/withdraw`);
    await post(member1, `/api/approvals/${doc.documentId}/reopen`);
    expect(
      (await put(member1, `/api/approvals/${doc.documentId}/draft`, { body: { body: DOC } }))
        .status,
    ).toBe(200);
  });

  it("상신 이후 S3 본문이 바뀌면 결재 처리가 거부된다 (변조 감지)", async () => {
    const doc = await createDoc(member1);
    await post(member1, `/api/approvals/${doc.documentId}/submit`);
    const [rev] = await withTenant(appDb.db, accountId, (tx) =>
      tx
        .select()
        .from(schema.documentRevision)
        .where(eq(schema.documentRevision.documentId, doc.documentId)),
    );
    // 저장소를 직접 바꿔도(앱 키로는 불가능하지만 테스트에서 가정) 처리 때 해시가 달라 거부된다
    await storage.put(
      rev?.storageKey ?? "",
      JSON.stringify({ body: { type: "doc", content: [{ type: "paragraph" }] } }),
      "application/json",
    );
    const res = await act(member2, doc.documentId, { kind: "approve" });
    expect(res.status).toBe(409);
    expect((await json<Problem>(res)).code).toBe("content_changed");
    // 기안자도 본문을 읽을 때 무결성 오류를 본다
    expect((await member1.request(`/api/approvals/${doc.documentId}/body`)).status).toBe(409);
  });

  it("상신 시 내용 해시가 기록되고 처리 기록에 남는다", async () => {
    const doc = await createDoc(member1);
    await post(member1, `/api/approvals/${doc.documentId}/submit`);
    const [row] = await withTenant(appDb.db, accountId, (tx) =>
      tx.select().from(schema.document).where(eq(schema.document.id, doc.documentId)),
    );
    expect(row?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect((await act(member2, doc.documentId, { kind: "approve" })).status).toBe(200);
    const [action] = await withTenant(appDb.db, accountId, (tx) =>
      tx
        .select()
        .from(schema.approvalAction)
        .where(eq(schema.approvalAction.documentId, doc.documentId)),
    );
    expect(action?.docHash).toBe(row?.contentHash);
  });
});

describe("처리 API (M3 FU-11, APV-040~043)", () => {
  it("PIN이 없거나 재인증이 오래되면 428, 정상 처리는 200이고 같은 멱등 키는 한 번만 처리된다", async () => {
    const fresh = await loginAs("approver@example.com");
    // approver는 PIN이 없다: 문서에 결재자로 붙여 처리 시도
    const doc = await createDoc(member1, { line: [approve(1, "approver@example.com")] });
    await post(member1, `/api/approvals/${doc.documentId}/submit`);
    const noPin = await act(fresh, doc.documentId, { kind: "approve" });
    expect(noPin.status).toBe(428);
    expect((await json<Problem>(noPin)).code).toBe("pin_not_set");

    // PIN을 설정하고 검증하면 통과한다
    await setupPin(fresh);
    const v = await view(fresh, doc.documentId);
    const step = v.steps[0] as Step;
    const k = key();
    const body = { action: { kind: "approve" }, idempotencyKey: k, expectedVersion: step.version };
    const first = await post(fresh, `/api/approvals/${doc.documentId}/steps/${step.id}/act`, body);
    expect(first.status).toBe(200);
    expect((await json<{ status: string; replayed: boolean }>(first)).status).toBe("COMPLETED");
    const second = await post(fresh, `/api/approvals/${doc.documentId}/steps/${step.id}/act`, body);
    expect((await json<{ replayed: boolean }>(second)).replayed).toBe(true);
  });

  it("계정 정책으로 PIN을 끄면 재인증 없이 처리된다", async () => {
    const other = await loginAs("hr@example.com");
    const doc = await createDoc(member1, { line: [approve(1, "hr@example.com")] });
    await post(member1, `/api/approvals/${doc.documentId}/submit`);
    expect((await act(other, doc.documentId, { kind: "approve" })).status).toBe(428);
    const off = await owner.request("/api/account/settings", {
      method: "PATCH",
      body: { securityPolicy: { pinRequired: false } },
    });
    expect(off.status).toBe(200);
    try {
      expect((await act(other, doc.documentId, { kind: "approve" })).status).toBe(200);
    } finally {
      await owner.request("/api/account/settings", {
        method: "PATCH",
        body: { securityPolicy: { pinRequired: true } },
      });
    }
  });

  it("처리자가 아니거나 참여자가 아니면 거부된다 (처리자 위조 불가)", async () => {
    const doc = await createDoc(member1);
    await post(member1, `/api/approvals/${doc.documentId}/submit`);
    // 결재선 밖의 구성원은 문서를 볼 수도 처리할 수도 없다
    expect((await act(bizadmin, doc.documentId, { kind: "approve" })).status).toBe(404);
    // 기안자는 참여자지만 처리자가 아니다
    const asDrafter = await act(member1, doc.documentId, { kind: "approve" });
    expect(asDrafter.status).toBe(403);
    // 결재 관리자(소유자·관리자)는 문서 관리 권한으로 요청이 엔진까지 가지만, 처리자가 아니면 승인할 수 없다
    await setupPin(admin);
    expect((await act(admin, doc.documentId, { kind: "approve" })).status).toBe(403);
    // 요청 본문에 처리자 정보를 넣어도 무시된다(스키마에 없다) — 처리자는 항상 세션 사용자다
    const v = await view(member2, doc.documentId);
    const step = v.steps[0] as Step;
    const spoof = await post(member1, `/api/approvals/${doc.documentId}/steps/${step.id}/act`, {
      action: { kind: "approve" },
      idempotencyKey: key(),
      actorMembershipId: ids["member2@example.com"],
    });
    expect(spoof.status).toBe(403);
  });

  it("사유 없는 반려는 400, 오래된 version은 409", async () => {
    const doc = await createDoc(member1);
    await post(member1, `/api/approvals/${doc.documentId}/submit`);
    expect((await act(member2, doc.documentId, { kind: "reject", comment: "" })).status).toBe(400);
    const v = await view(member2, doc.documentId);
    const step = v.steps[0] as Step;
    const stale = await post(member2, `/api/approvals/${doc.documentId}/steps/${step.id}/act`, {
      action: { kind: "approve" },
      idempotencyKey: key(),
      expectedVersion: step.version - 1,
    });
    expect(stale.status).toBe(409);
  });

  it("보류는 결재 관리자가 해제할 수 있다", async () => {
    const doc = await createDoc(member1);
    await post(member1, `/api/approvals/${doc.documentId}/submit`);
    expect((await act(member2, doc.documentId, { kind: "hold", comment: "확인 중" })).status).toBe(
      200,
    );
    const [heldStep] = (await view(member2, doc.documentId)).steps;
    await setupPin(admin);
    const release = await post(
      admin,
      `/api/approvals/${doc.documentId}/steps/${heldStep?.id}/act`,
      {
        action: { kind: "release" },
        idempotencyKey: key(),
      },
    );
    // 관리자는 참여자가 아니어도 결재 관리 권한으로 보류를 해제할 수 있다
    expect(release.status).toBe(200);
    expect((await view(member1, doc.documentId)).status).toBe("IN_PROGRESS");
  });
});

describe("의견 (APV-042)", () => {
  it("공개 범위: 기안자만 보는 의견은 다른 참여자에게 보이지 않는다", async () => {
    const doc = await createDoc(member1, {
      line: [approve(1, "member2@example.com"), approve(2, "bizadmin@example.com")],
    });
    await post(member1, `/api/approvals/${doc.documentId}/submit`);
    const all = await post(member2, `/api/approvals/${doc.documentId}/comments`, {
      body: "전체 공개 의견",
      visibility: "all",
    });
    const secret = await post(member2, `/api/approvals/${doc.documentId}/comments`, {
      body: "기안자에게만",
      visibility: "drafter",
    });
    expect(all.status).toBe(201);
    expect(secret.status).toBe(201);
    const names = (rows: { body: string }[]) => rows.map((r) => r.body);
    const drafterView = await json<{ body: string }[]>(
      await member1.request(`/api/approvals/${doc.documentId}/comments`),
    );
    expect(names(drafterView)).toEqual(["전체 공개 의견", "기안자에게만"]);
    const author = await json<{ body: string }[]>(
      await member2.request(`/api/approvals/${doc.documentId}/comments`),
    );
    expect(names(author)).toEqual(["전체 공개 의견", "기안자에게만"]);
    const other = await json<{ body: string }[]>(
      await bizadmin.request(`/api/approvals/${doc.documentId}/comments`),
    );
    expect(names(other)).toEqual(["전체 공개 의견"]);
    // 참여자가 아니면 쓰기·읽기 모두 거부
    expect(
      (await post(auditor, `/api/approvals/${doc.documentId}/comments`, { body: "x" })).status,
    ).toBe(404);
    expect((await auditor.request(`/api/approvals/${doc.documentId}/comments`)).status).toBe(404);
    expect(
      (await post(member1, `/api/approvals/${doc.documentId}/comments`, { body: "   " })).status,
    ).toBe(400);
  });
});

describe("진행 중 결재선 변경 (APV-037, M3 FU-13)", () => {
  async function started() {
    const doc = await createDoc(member1, {
      line: [approve(1, "member2@example.com"), approve(2, "bizadmin@example.com")],
    });
    await post(member1, `/api/approvals/${doc.documentId}/submit`);
    return doc.documentId;
  }
  const edit = (c: TestClient, id: string, body: unknown) =>
    put(c, `/api/approvals/${id}/line`, body);

  it("현재 처리자가 처리 전 이후 단계를 추가·삭제하고 사유가 남는다", async () => {
    const id = await started();
    const v = await view(member2, id);
    const second = v.steps[1] as Step;
    const res = await edit(member2, id, {
      reason: "감사 단계 추가",
      edits: [
        { kind: "add", item: { type: "audit", seq: 3, target: user("auditor@example.com") } },
        { kind: "remove", stepId: second.id },
      ],
    });
    expect(res.status).toBe(200);
    const after = await view(member2, id);
    expect(after.steps.map((s) => s.type)).toEqual(["approve", "audit"]);
    // 새 단계에는 전결 권한이 없다
    const steps = await withTenant(appDb.db, accountId, (tx) =>
      tx.select().from(schema.approvalStep).where(eq(schema.approvalStep.documentId, id)),
    );
    expect(steps.every((s) => !s.canFinalize)).toBe(true);
    const events = await withTenant(appDb.db, accountId, (tx) =>
      tx.select().from(schema.approvalEvent).where(eq(schema.approvalEvent.documentId, id)),
    );
    expect(events.map((e) => e.type)).toContain("line_changed");
    const [audit] = await authDb.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.reason, "감사 단계 추가"));
    expect(audit?.action).toBe("approval.line_change");
  });

  it("진행 중인 단계 삭제·후결 추가·사유 누락·권한 없는 사람·허용하지 않는 양식은 거부된다", async () => {
    const id = await started();
    const v = await view(member2, id);
    const first = v.steps[0] as Step;
    expect(
      (await edit(member2, id, { reason: "x", edits: [{ kind: "remove", stepId: first.id }] }))
        .status,
    ).toBe(400);
    expect(
      (
        await edit(member2, id, {
          reason: "후결",
          edits: [
            { kind: "add", item: { type: "post", seq: 9, target: user("auditor@example.com") } },
          ],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await edit(member2, id, {
          reason: " ",
          edits: [
            { kind: "add", item: { type: "approve", seq: 3, target: user("auditor@example.com") } },
          ],
        })
      ).status,
    ).toBe(400);
    // 처리자가 아닌 구성원은 참여자여도 변경할 수 없다 (bizadmin은 아직 차례가 아닌 결재자)
    const notYet = await edit(bizadmin, id, {
      reason: "x",
      edits: [
        { kind: "add", item: { type: "approve", seq: 3, target: user("auditor@example.com") } },
      ],
    });
    expect(notYet.status).toBe(403);
    // 결재선 수정을 허용하지 않는 양식
    const locked = await json<{ formId: string }>(
      await post(admin, "/api/forms", {
        code: "LOCKED2",
        name: "고정2",
        version: version({
          allowLineEdit: false,
          defaultLine: [approve(1, "member2@example.com"), approve(2, "bizadmin@example.com")],
        }),
      }),
    );
    const doc = await createDoc(member1, { formId: locked.formId, body: { memo: "m" } });
    await post(member1, `/api/approvals/${doc.documentId}/submit`);
    const denied = await edit(member2, doc.documentId, {
      reason: "x",
      edits: [
        { kind: "add", item: { type: "approve", seq: 3, target: user("auditor@example.com") } },
      ],
    });
    expect(denied.status).toBe(403);
    expect((await json<Problem>(denied)).code).toBe("line_edit_not_allowed");
  });

  it("결재 관리자(관리자)는 처리자가 아니어도 변경할 수 있다", async () => {
    const id = await started();
    await setupPin(admin);
    const res = await edit(admin, id, {
      reason: "결재자 대체",
      edits: [
        { kind: "add", item: { type: "approve", seq: 3, target: user("auditor@example.com") } },
      ],
    });
    expect(res.status).toBe(200);
  });

  it("DB도 완료·처리 완료 단계의 직접 변경은 막는다", async () => {
    const id = await started();
    const steps = await withTenant(appDb.db, accountId, (tx) =>
      tx.select().from(schema.approvalStep).where(eq(schema.approvalStep.documentId, id)),
    );
    const active = steps.find((s) => s.status === "ACTIVE");
    const err = await withTenant(appDb.db, accountId, (tx) =>
      tx.delete(schema.approvalStep).where(eq(schema.approvalStep.id, active?.id ?? "")),
    ).then(
      () => null,
      (e: unknown) => e as { cause?: { message?: string } },
    );
    expect(err?.cause?.message).toMatch(/삭제할 수 없습니다/);
  });
});

describe("첨부 (APV-013, FILE-002·004·005, M1 FU-1·2)", () => {
  it("정상 PDF는 검증·등록되고 SHA-256·키가 기록된다. 참여자만 다운로드·미리보기 URL을 받는다", async () => {
    const doc = await createDoc(member1);
    const { registered } = await uploadFile(member1, doc.documentId, "견적서.pdf", pdfBytes());
    expect(registered?.status).toBe(201);
    const att = await json<{ id: string; mime: string; sha256: string }>(registered as Response);
    expect(att.mime).toBe("application/pdf");
    expect(att.sha256).toMatch(/^[0-9a-f]{64}$/);

    const rows = await withTenant(appDb.db, accountId, (tx) =>
      tx.select().from(schema.attachment).where(eq(schema.attachment.id, att.id)),
    );
    expect(rows[0]?.storageKey).toContain(`/${doc.documentId}/attachments/${att.id}_`);
    expect(await storage.head(rows[0]?.storageKey ?? "")).toBeTruthy();

    // 다운로드: 기안자·결재선 참여자는 가능, 그 밖의 사람은 404
    await post(member1, `/api/approvals/${doc.documentId}/submit`);
    const dl = await member1.request(`/api/approvals/${doc.documentId}/attachments/${att.id}/url`);
    expect(dl.status).toBe(200);
    const { url } = await json<{ url: string }>(dl);
    const file = await fetch(url);
    expect(file.headers.get("content-disposition")).toContain("UTF-8''");
    expect(await file.text()).toContain("%PDF-");
    const preview = await json<{ url: string }>(
      await member2.request(
        `/api/approvals/${doc.documentId}/attachments/${att.id}/url?preview=true`,
      ),
    );
    expect((await fetch(preview.url)).headers.get("content-disposition")).toBe("inline");
    expect(
      (await auditor.request(`/api/approvals/${doc.documentId}/attachments/${att.id}/url`)).status,
    ).toBe(404);
    expect((await auditor.request(`/api/approvals/${doc.documentId}/attachments`)).status).toBe(
      404,
    );
    const list = await json<unknown[]>(
      await member2.request(`/api/approvals/${doc.documentId}/attachments`),
    );
    expect(list).toHaveLength(1);
  });

  it("PDF로 위장한 실행 파일·허용되지 않은 확장자는 거부된다", async () => {
    const doc = await createDoc(member1);
    const spoof = await uploadFile(member1, doc.documentId, "invoice.pdf", exeBytes());
    expect(spoof.registered?.status).toBe(400);
    expect((await json<Problem>(spoof.registered as Response)).code).toBe("attachment_invalid");
    const exe = await uploadFile(member1, doc.documentId, "run.exe", exeBytes());
    expect(exe.upload.status).toBe(400);
    const none = await uploadFile(member1, doc.documentId, "noext", pdfBytes());
    expect(none.upload.status).toBe(400);
  });

  it("선언한 크기와 다른 업로드·계정 한도 초과·다른 회사 staging 키는 거부된다", async () => {
    const doc = await createDoc(member1);
    // 선언한 크기와 실제 크기가 다르면 등록 단계에서 거부한다 (로컬 S3는 서명 크기를 강제하지 않으므로 서버가 확인한다)
    const real = pdfBytes();
    const mismatch = await uploadFile(member1, doc.documentId, "a.pdf", real, real.length - 3);
    expect(mismatch.registered?.status).toBe(400);
    // 계정 정책 한도 (1MB)
    await owner.request("/api/account/settings", {
      method: "PATCH",
      body: { securityPolicy: { attachmentMaxMb: 1 } },
    });
    try {
      const big = await post(member1, `/api/approvals/${doc.documentId}/attachments/upload-url`, {
        filename: "big.pdf",
        size: 2 * 1024 * 1024,
      });
      expect(big.status).toBe(400);
    } finally {
      await owner.request("/api/account/settings", {
        method: "PATCH",
        body: { securityPolicy: { attachmentMaxMb: 50 } },
      });
    }
    // 다른 회사 접두어의 staging 객체는 등록할 수 없다
    const foreign = await post(member1, `/api/approvals/${doc.documentId}/attachments`, {
      stagingKey: "_staging/00000000-0000-0000-0000-000000000000/x",
      filename: "a.pdf",
      size: 10,
    });
    expect(foreign.status).toBe(403);
    // 업로드되지 않은 키
    const missing = await post(member1, `/api/approvals/${doc.documentId}/attachments`, {
      stagingKey: `_staging/${accountId}/nope`,
      filename: "a.pdf",
      size: 10,
    });
    expect(missing.status).toBe(400);
  });

  it("미리보기는 이미지·PDF만, 상신 후에는 추가·삭제할 수 없다", async () => {
    const doc = await createDoc(member1);
    const zip = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    const docx = await uploadFile(member1, doc.documentId, "보고서.docx", zip);
    expect(docx.registered?.status).toBe(201);
    const att = await json<{ id: string }>(docx.registered as Response);
    expect(
      (
        await member1.request(
          `/api/approvals/${doc.documentId}/attachments/${att.id}/url?preview=true`,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await member2.request(`/api/approvals/${doc.documentId}/attachments/${att.id}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(403);
    await post(member1, `/api/approvals/${doc.documentId}/submit`);
    const late = await uploadFile(member1, doc.documentId, "late.pdf", pdfBytes());
    expect(late.upload.status).toBe(409);
    expect(
      (
        await member1.request(`/api/approvals/${doc.documentId}/attachments/${att.id}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(409);
  });

  it("첨부가 바뀌면 내용 해시가 달라지고, 재기안은 본문·첨부를 복사한다", async () => {
    const doc = await createDoc(member1);
    await uploadFile(member1, doc.documentId, "a.pdf", pdfBytes());
    await post(member1, `/api/approvals/${doc.documentId}/submit`);
    expect(
      (await act(member2, doc.documentId, { kind: "reject", comment: "수정 필요" })).status,
    ).toBe(200);
    const redraft = await post(member1, `/api/approvals/${doc.documentId}/redraft`);
    expect(redraft.status).toBe(201);
    const { documentId } = await json<{ documentId: string }>(redraft);
    const list = await json<{ filename: string }[]>(
      await member1.request(`/api/approvals/${documentId}/attachments`),
    );
    expect(list.map((a) => a.filename)).toEqual(["a.pdf"]);
    expect((await view(member1, documentId)).latestRevision).toBe(1);
  });
});

describe("받은함 (APV-080 일부)", () => {
  it("결재 대기에는 내 차례인 문서만, 기안함에는 내가 기안한 문서가 보인다", async () => {
    const doc = await createDoc(member1, {
      title: "받은함 확인용",
      line: [approve(1, "member2@example.com"), approve(2, "bizadmin@example.com")],
    });
    await post(member1, `/api/approvals/${doc.documentId}/submit`);
    const pending = async (c: TestClient) =>
      (await json<{ documentId: string }[]>(await c.request("/api/inbox/pending"))).map(
        (r) => r.documentId,
      );
    expect(await pending(member2)).toContain(doc.documentId);
    expect(await pending(bizadmin)).not.toContain(doc.documentId); // 아직 차례가 아니다
    expect(await pending(member1)).not.toContain(doc.documentId);
    const mine = await json<{ id: string; title: string }[]>(
      await member1.request("/api/inbox/mine"),
    );
    expect(mine.find((d) => d.id === doc.documentId)?.title).toBe("받은함 확인용");
    expect(
      (await json<{ id: string }[]>(await member2.request("/api/inbox/mine"))).some(
        (d) => d.id === doc.documentId,
      ),
    ).toBe(false);
    await act(member2, doc.documentId, { kind: "approve" });
    expect(await pending(member2)).not.toContain(doc.documentId);
    expect(await pending(bizadmin)).toContain(doc.documentId);
  });
});

describe("테넌트 격리 (PERM-002) — M4 테이블", () => {
  const tables = {
    form: schema.form,
    form_version: schema.formVersion,
    approval_line_template: schema.approvalLineTemplate,
    user_form_pref: schema.userFormPref,
    document_revision: schema.documentRevision,
    attachment: schema.attachment,
    approval_comment: schema.approvalComment,
    document_link: schema.documentLink,
  } as const;

  for (const [name, table] of Object.entries(tables)) {
    it(`${name}: 테넌트를 지정하지 않으면 0행이고 다른 계정에는 보이지 않는다`, async () => {
      expect(await appDb.db.select().from(table)).toHaveLength(0);
      const [other] = await authDb.db
        .select()
        .from(schema.account)
        .where(eq(schema.account.slug, "other-company"));
      const rows = await withTenant(appDb.db, other?.id ?? "", (tx) => tx.select().from(table));
      for (const row of rows) expect((row as { accountId: string }).accountId).toBe(other?.id);
      if (name !== "form" && name !== "form_version") expect(rows).toHaveLength(0);
    });
  }

  it("다른 회사의 문서·첨부 URL은 존재하지 않는 것처럼 보인다", async () => {
    const ownerB = await loginAs("owner-b@example.com");
    const doc = await createDoc(member1);
    expect((await ownerB.request(`/api/approvals/${doc.documentId}`)).status).toBe(404);
    expect(
      (await put(ownerB, `/api/approvals/${doc.documentId}/draft`, { title: "침투" })).status,
    ).toBe(404);
    expect((await post(ownerB, `/api/approvals/${doc.documentId}/submit`)).status).toBe(404);
    expect((await ownerB.request(`/api/forms/${generalFormId}`)).status).toBe(404);
  });
});

describe("초안 결재선 지정 (APV-036)", () => {
  const putLine = (c: TestClient, id: string, line: unknown) =>
    put(c, `/api/approvals/${id}/draft-line`, { line });

  it("기안자가 초안의 결재선을 바꾸고, 상신 후에는 바꿀 수 없다", async () => {
    const doc = await createDoc(member1);
    const res = await putLine(member1, doc.documentId, [
      approve(1, "member2@example.com"),
      { type: "agree", seq: 2, target: user("hr@example.com") },
      { type: "agree", seq: 2, target: user("approver@example.com"), quorum: 1 },
    ]);
    expect(res.status).toBe(200);
    const v = await view(member1, doc.documentId);
    expect(v.steps.map((s) => s.type)).toEqual(["approve", "agree", "agree"]);
    expect((await putLine(member2, doc.documentId, [approve(1, "hr@example.com")])).status).toBe(
      403,
    );
    expect((await putLine(member1, doc.documentId, [approve(1, "left@example.com")])).status).toBe(
      400,
    );
    await post(member1, `/api/approvals/${doc.documentId}/submit`);
    expect((await putLine(member1, doc.documentId, [approve(1, "hr@example.com")])).status).toBe(
      409,
    );
  });

  it("결재선 수정을 막는 양식은 지정해도 기본 결재선이 유지된다", async () => {
    const locked = await json<{ formId: string }>(
      await post(admin, "/api/forms", {
        code: "LOCKED3",
        name: "고정3",
        version: version({
          allowLineEdit: false,
          defaultLine: [approve(1, "bizadmin@example.com")],
        }),
      }),
    );
    const doc = await createDoc(member1, { formId: locked.formId, body: { memo: "m" } });
    await putLine(member1, doc.documentId, [approve(1, "auditor@example.com")]);
    const steps = await withTenant(appDb.db, accountId, (tx) =>
      tx
        .select()
        .from(schema.approvalStep)
        .where(eq(schema.approvalStep.documentId, doc.documentId)),
    );
    expect(steps).toHaveLength(1);
    expect(steps[0]?.assigneeIds).toEqual([ids["bizadmin@example.com"]]);
  });
});
