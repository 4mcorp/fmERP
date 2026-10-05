// M6 통합 테스트: 감사 단계 대상(AUD-001), 감사인 열람 기록(AUD-010), 타임라인(AUD-011), 감사 로그 조회(AUD-025), 월간 점검(AUD-026) (실제 DB)

import { reviewTargetPeriod } from "@fmerp/core";
import { createDatabase, schema, withTenant } from "@fmerp/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientWithCookie, json, loginAs, type TestClient } from "../test-client";

const authDb = createDatabase(process.env.AUTH_DATABASE_URL ?? "");
const appDb = createDatabase(process.env.DATABASE_URL ?? "");
afterAll(async () => {
  await authDb.pool.end();
  await appDb.pool.end();
});

let accountId: string;
let businessId: string;
let mgtDepartmentId: string;
let ids: Record<string, string>;
let generalFormId: string;
const clients: Record<string, TestClient> = {};
const DOC = { type: "doc", content: [] };
let keySeq = 0;
const key = () => `m6-${++keySeq}-${Math.random().toString(36).slice(2)}`;
const req = (who: string, path: string, method = "GET", body?: unknown) =>
  (clients[who] as TestClient).request(path, {
    method,
    body: body === undefined && method !== "GET" ? {} : body,
    // 접속지(AUD-021)가 기록되는지 보려고 프록시 헤더를 흉내 낸다 (개발·테스트에서만 믿는 헤더)
    headers: { "x-forwarded-for": "203.0.113.7" },
  });

interface View {
  status: string;
  steps: { id: string; status: string; version: number }[];
}
interface RecipientView {
  id: string;
  kind: string;
  targetName: string;
  receivedByName: string | null;
  reads: { name: string }[];
  distributedTo: { name: string }[];
}

const approveStep = (seq: number, email: string) => ({
  type: "approve",
  seq,
  target: { kind: "user", membershipId: ids[email] },
});

async function createDoc(over: Record<string, unknown> = {}) {
  const res = await req("member1", "/api/approvals", "POST", {
    businessId,
    formId: generalFormId,
    title: "M6 감사 테스트",
    body: { body: DOC },
    line: [approveStep(1, "member2@example.com")],
    ...over,
  });
  if (res.status !== 201) throw new Error(`문서 생성 실패 ${res.status} ${await res.text()}`);
  return (await json<{ documentId: string }>(res)).documentId;
}
const status = async (who: string, id: string) => (await req(who, `/api/approvals/${id}`)).status;
const recipients = async (who: string, id: string) =>
  json<RecipientView[]>(await req(who, `/api/approvals/${id}/recipients`));

async function setRecipients(id: string, items: unknown[]) {
  const res = await req("member1", `/api/approvals/${id}/recipients`, "PUT", { items });
  expect(res.status).toBe(200);
}
async function submit(id: string) {
  const res = await req("member1", `/api/approvals/${id}/submit`, "POST");
  if (res.status !== 200) throw new Error(`상신 실패 ${res.status} ${await res.text()}`);
}
async function complete(id: string) {
  const v = await json<View>(await req("member1", `/api/approvals/${id}`));
  const step = v.steps.find((s) => s.status === "ACTIVE");
  const res = await req("member2", `/api/approvals/${id}/steps/${step?.id}/act`, "POST", {
    action: { kind: "approve" },
    idempotencyKey: key(),
    expectedVersion: step?.version,
  });
  if (res.status !== 200) throw new Error(`승인 실패 ${res.status} ${await res.text()}`);
}

const member = (email: string) => ({ type: "member", id: ids[email] });
const dept = () => ({ type: "department", id: mgtDepartmentId });

beforeAll(async () => {
  for (const who of [
    "member1",
    "member2",
    "hr",
    "admin",
    "owner",
    "auditor",
    "bizadmin",
    "approver",
    "multi",
    "owner-b",
  ]) {
    clients[who] = await loginAs(`${who}@example.com`);
  }
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
  const departments = await withTenant(appDb.db, accountId, (tx) =>
    tx.select().from(schema.department),
  );
  mgtDepartmentId =
    departments.find((d) => d.businessId === businessId && d.code === "MGT")?.id ?? "";
  const forms = await json<{ id: string; code: string }[]>(await req("member1", "/api/forms"));
  generalFormId = forms.find((f) => f.code === "GENERAL")?.id ?? "";
  for (const who of ["member1", "member2"]) {
    await req(who, "/api/me/pin", "PUT", { pin: "246810" });
    expect((await req(who, "/api/me/pin/verify", "POST", { pin: "246810" })).status).toBe(200);
  }
});

describe("감사 단계 대상 (AUD-001)", () => {
  const auditStep = (email: string) => ({
    type: "audit",
    seq: 2,
    target: { kind: "user", membershipId: ids[email] },
  });

  it("감사인 역할이 없는 구성원을 감사 단계에 넣으면 거부한다", async () => {
    const res = await req("member1", "/api/approvals", "POST", {
      businessId,
      formId: generalFormId,
      title: "감사 단계 대상 검증",
      body: { body: DOC },
      line: [approveStep(1, "member2@example.com"), auditStep("approver@example.com")],
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("감사인");
  });

  it("감사인 역할 보유자는 감사 단계에 넣을 수 있다", async () => {
    const id = await createDoc({
      line: [approveStep(1, "member2@example.com"), auditStep("auditor@example.com")],
    });
    expect(id).toBeTruthy();
  });
});

const auditRows = (action: string, documentId: string) =>
  authDb.db
    .select()
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.accountId, accountId),
        eq(schema.auditLog.action, action),
        eq(schema.auditLog.targetId, documentId),
      ),
    );

async function submittedDoc(over: Record<string, unknown> = {}) {
  const id = await createDoc(over);
  await submit(id);
  return id;
}

describe("감사인 열람 기록 (AUD-010)", () => {
  it("감사인·소유자의 열람은 기록하고, 10분 안 재열람은 늘리지 않는다", async () => {
    const id = await submittedDoc();
    expect(await auditRows("document.audit_view", id)).toHaveLength(0);
    expect(await status("auditor", id)).toBe(200);
    expect(await auditRows("document.audit_view", id)).toHaveLength(1);
    // 본문을 읽어도, 새로고침해도 같은 사용자·문서는 한 건
    expect((await req("auditor", `/api/approvals/${id}/body`)).status).toBe(200);
    expect(await status("auditor", id)).toBe(200);
    expect(await auditRows("document.audit_view", id)).toHaveLength(1);
    // 다른 사용자(소유자)는 따로 기록
    expect(await status("owner", id)).toBe(200);
    const rows = await auditRows("document.audit_view", id);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.result === "success" && r.actorUserId)).toBe(true);
  });

  it("화면이 여러 API를 동시에 불러도 감사 열람은 한 건만 기록한다", async () => {
    const id = await submittedDoc();
    const paths = ["", "/body", "/comments", "/timeline", "/form", "/package", "/attachments"];
    const calls = Array.from({ length: 4 }, () => paths).flat();
    const results = await Promise.all(calls.map((p) => req("auditor", `/api/approvals/${id}${p}`)));
    expect(results.filter((r) => r.status === 200).length).toBeGreaterThan(10);
    expect(await auditRows("document.audit_view", id)).toHaveLength(1);
  });

  it("기안자·결재선 참여자의 열람은 기록하지 않는다", async () => {
    const id = await submittedDoc();
    expect(await status("member1", id)).toBe(200);
    expect(await status("member2", id)).toBe(200);
    expect(await auditRows("document.audit_view", id)).toHaveLength(0);
  });

  it("10분이 지나면 다시 기록한다", async () => {
    const id = await submittedDoc();
    expect(await status("auditor", id)).toBe(200);
    // 기록 시각을 과거로 돌려 시간 경과를 흉내 낸다 (앱·인증 계정은 UPDATE할 수 없어 마이그레이션 계정으로)
    const migrator = createDatabase(process.env.MIGRATION_DATABASE_URL ?? "");
    await migrator.pool.query(
      "update audit_log set occurred_at = now() - interval '11 minutes' where action = 'document.audit_view' and target_id = $1",
      [id],
    );
    await migrator.pool.end();
    expect(await status("auditor", id)).toBe(200);
    expect(await auditRows("document.audit_view", id)).toHaveLength(2);
  });

  it("범위 밖 감사인과 임시저장 문서는 기록 없이 404다", async () => {
    const draft = await createDoc();
    expect(await status("auditor", draft)).toBe(404);
    expect(await auditRows("document.audit_view", draft)).toHaveLength(0);
  });
});

describe("감사인은 읽기 전용이다", () => {
  it("결재 처리·의견·접수 같은 쓰기 요청은 거부한다", async () => {
    const id = await submittedDoc();
    const v = await json<View>(await req("auditor", `/api/approvals/${id}`));
    const step = v.steps.find((s) => s.status === "ACTIVE");
    const act = await req("auditor", `/api/approvals/${id}/steps/${step?.id}/act`, "POST", {
      action: { kind: "approve" },
      idempotencyKey: key(),
      expectedVersion: step?.version,
    });
    expect(act.status).toBeGreaterThanOrEqual(400);
    expect(act.status).toBeLessThan(500);
    const comment = await req("auditor", `/api/approvals/${id}/comments`, "POST", {
      body: "감사인 의견",
      visibility: "all",
    });
    expect(comment.status).toBeGreaterThanOrEqual(400);
    expect(comment.status).toBeLessThan(500);
    const after = await json<View>(await req("member1", `/api/approvals/${id}`));
    expect(after.status).toBe("IN_PROGRESS");
  });
});

interface TimelineItem {
  kind: string;
  label: string;
  actor: string | null;
  onBehalfOf: string | null;
  ip: string | null;
}
const timeline = async (who: string, id: string) =>
  json<TimelineItem[]>(await req(who, `/api/approvals/${id}/timeline`));

describe("문서 이력 타임라인 (AUD-011)", () => {
  it("작성 → 상신 → 승인 → 완료를 순서대로 보이고 같은 사건을 중복하지 않는다", async () => {
    const id = await submittedDoc();
    await complete(id);
    const items = await timeline("member1", id);
    expect(items.map((i) => i.label)).toEqual(["작성", "상신", "승인", "완료"]);
    expect(items.filter((i) => i.label === "승인")).toHaveLength(1);
    expect(items[2]?.actor).toBeTruthy();
  });

  it("접속지와 감사 열람은 감사 권한자에게만 보인다", async () => {
    const id = await submittedDoc();
    expect(await status("auditor", id)).toBe(200); // 감사 열람 기록을 남긴다
    const mine = await timeline("member1", id);
    expect(mine.every((i) => i.ip === null)).toBe(true);
    expect(mine.map((i) => i.label)).not.toContain("감사 열람");
    const audited = await timeline("auditor", id);
    expect(audited.map((i) => i.label)).toContain("감사 열람");
    expect(audited.some((i) => i.ip !== null)).toBe(true);
  });

  it("다운로드·인쇄·공람 같은 후속 행위도 이력에 남는다", async () => {
    const id = await submittedDoc();
    expect((await req("member1", `/api/approvals/${id}/print-log`, "POST")).status).toBe(200);
    const items = await timeline("member1", id);
    const print = items.find((i) => i.label === "인쇄");
    expect(print?.actor).toBeTruthy();
  });

  it("열람 권한이 없으면 타임라인도 인쇄 기록도 404다", async () => {
    const id = await submittedDoc();
    for (const who of ["multi", "admin", "owner-b"]) {
      expect((await req(who, `/api/approvals/${id}/timeline`)).status, who).toBe(404);
      expect((await req(who, `/api/approvals/${id}/print-log`, "POST")).status, who).toBe(404);
    }
    expect(await auditRows("document.print", id)).toHaveLength(0);
  });

  it("임시저장 문서는 감사인에게 404다", async () => {
    const draft = await createDoc();
    expect((await req("auditor", `/api/approvals/${draft}/timeline`)).status).toBe(404);
  });
});

interface LogPage {
  items: {
    id: string;
    occurredAt: string;
    action: string;
    targetId: string | null;
    actorName: string | null;
    ip: string | null;
  }[];
  nextCursor: string | null;
}
const logs = async (who: string, query = "") =>
  json<LogPage>(await req(who, `/api/audit-logs${query}`));

describe("감사 로그 조회 (AUD-025)", () => {
  it("계정 범위 감사 권한자(소유자·관리자)만 볼 수 있다", async () => {
    for (const who of ["owner", "admin"]) {
      expect((await req(who, "/api/audit-logs")).status, who).toBe(200);
    }
    // 일반 구성원과 부서 범위 감사인은 전체 로그를 볼 수 없다
    for (const who of ["member1", "auditor", "hr", "bizadmin"]) {
      expect((await req(who, "/api/audit-logs")).status, who).toBe(403);
    }
  });

  it("행위·대상 필터와 행위자 이름·접속지를 돌려준다", async () => {
    const id = await submittedDoc();
    const page = await logs("owner", `?targetId=${id}`);
    expect(page.items.map((i) => i.action).sort()).toEqual(["approval.create", "approval.submit"]);
    expect(page.items.every((i) => i.actorName && i.ip)).toBe(true);
    const only = await logs("owner", `?targetId=${id}&action=approval.submit`);
    expect(only.items).toHaveLength(1);
    // 점(.)으로 끝나면 접두사 필터
    const prefix = await logs("owner", `?targetId=${id}&action=approval.`);
    expect(prefix.items).toHaveLength(2);
    expect((await logs("owner", `?targetId=${id}&action=document.`)).items).toHaveLength(0);
  });

  it("기간 필터: 미래 시작이면 비고, 지난 시작이면 포함한다", async () => {
    const id = await submittedDoc();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect((await logs("owner", `?targetId=${id}&from=${future}`)).items).toHaveLength(0);
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect((await logs("owner", `?targetId=${id}&from=${past}`)).items.length).toBeGreaterThan(0);
    expect((await logs("owner", `?targetId=${id}&to=${past}`)).items).toHaveLength(0);
  });

  it("커서로 이어 읽으면 겹침·누락 없이 최근 순이다", async () => {
    const first = await logs("owner", "?limit=3");
    expect(first.items).toHaveLength(3);
    expect(first.nextCursor).toBeTruthy();
    const second = await logs("owner", `?limit=3&cursor=${first.nextCursor}`);
    const all = [...first.items, ...second.items];
    expect(new Set(all.map((i) => i.id)).size).toBe(6);
    const times = all.map((i) => Date.parse(i.occurredAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect((await req("owner", "/api/audit-logs?cursor=abc")).status).toBe(400);
  });

  it("조회 행위도 기록한다 (첫 쪽만)", async () => {
    const count = async () =>
      (
        await authDb.db
          .select()
          .from(schema.auditLog)
          .where(
            and(
              eq(schema.auditLog.accountId, accountId),
              eq(schema.auditLog.action, "audit.view_log"),
            ),
          )
      ).length;
    const before = await count();
    const page = await logs("owner", "?limit=1");
    expect(await count()).toBe(before + 1);
    await logs("owner", `?limit=1&cursor=${page.nextCursor}`);
    expect(await count()).toBe(before + 1);
  });

  it("다른 회사의 로그는 보이지 않는다", async () => {
    const id = await submittedDoc();
    expect((await logs("owner-b", `?targetId=${id}`)).items).toHaveLength(0);
  });
});

interface Overview {
  targetPeriod: string;
  overdue: boolean;
  months: {
    period: string;
    state: "pending" | "done" | "abnormal";
    last: { memo: string | null; abnormal: boolean; reviewerName: string } | null;
  }[];
}
const overview = async (who: string) => json<Overview>(await req(who, "/api/audit-logs/reviews"));
const review = (who: string, body: unknown) => req(who, "/api/audit-logs/reviews", "POST", body);

describe("월간 접속 기록 점검 (AUD-026)", () => {
  it("직전 달부터 12개월을 돌려주고, 점검 대상 달은 직전 달이다", async () => {
    const o = await overview("owner");
    expect(o.months).toHaveLength(12);
    expect(o.months[0]?.period).toBe(o.targetPeriod);
    expect(o.months[0]?.period).toBe(reviewTargetPeriod(new Date()));
  });

  it("점검 완료를 남기면 상태가 바뀌고, 같은 달 정정은 마지막 건이 현재 상태다", async () => {
    const period = (await overview("admin")).targetPeriod;
    const bad = await review("admin", { period, abnormal: true, abnormalNote: "심야 대량 조회" });
    expect(bad.status).toBe(201);
    let m = (await overview("owner")).months[0];
    expect(m?.state).toBe("abnormal");
    expect(m?.last?.reviewerName).toBeTruthy();

    const fixed = await review("owner", { period, abnormal: false, memo: "확인 후 정상" });
    expect(fixed.status).toBe(201);
    m = (await overview("owner")).months[0];
    expect(m?.state).toBe("done");
    expect(m?.last?.memo).toBe("확인 후 정상");
    expect((await overview("owner")).overdue).toBe(false);
  });

  it("점검할 수 없는 달·이상 내용 누락·형식 오류는 거부한다", async () => {
    const period = (await overview("owner")).targetPeriod;
    // 이번 달과 12개월보다 오래된 달은 점검 대상이 아니다
    const now = new Date();
    const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    expect((await review("owner", { period: thisMonth, abnormal: false })).status).toBe(400);
    expect((await review("owner", { period: "2000-01", abnormal: false })).status).toBe(400);
    expect((await review("owner", { period, abnormal: true })).status).toBe(400);
    expect((await review("owner", { period, abnormal: true, abnormalNote: "  " })).status).toBe(
      400,
    );
    expect((await review("owner", { period: "2026-13", abnormal: false })).status).toBe(400);
  });

  it("점검 기록은 감사 로그에도 남는다", async () => {
    const period = (await overview("owner")).targetPeriod;
    await review("owner", { period, abnormal: false });
    const rows = await authDb.db
      .select()
      .from(schema.auditLog)
      .where(
        and(eq(schema.auditLog.accountId, accountId), eq(schema.auditLog.action, "audit.review")),
      );
    expect(rows.some((r) => r.targetLabel === period)).toBe(true);
  });

  it("권한 없는 사용자는 조회·등록할 수 없다", async () => {
    const period = (await overview("owner")).targetPeriod;
    for (const who of ["member1", "auditor", "hr"]) {
      expect((await req(who, "/api/audit-logs/reviews")).status, who).toBe(403);
      expect((await review(who, { period, abnormal: false })).status, who).toBe(403);
    }
  });

  it("다른 회사의 점검 기록과 섞이지 않는다", async () => {
    const other = await overview("owner-b");
    expect(other.months.every((m) => m.last === null)).toBe(true);
  });

  it("점검 기록은 수정·삭제할 수 없다 (앱 계정은 INSERT·SELECT만)", async () => {
    await expect(appDb.pool.query("update audit_review set memo = 'x'")).rejects.toThrow(
      /permission denied/,
    );
    await expect(appDb.pool.query("delete from audit_review")).rejects.toThrow(/permission denied/);
  });
});

describe("인증 없는 접근", () => {
  it("로그인하지 않으면 감사 API는 모두 401이다", async () => {
    const anon = clientWithCookie("");
    const id = await submittedDoc();
    for (const [path, method] of [
      ["/api/audit-logs", "GET"],
      ["/api/audit-logs/reviews", "GET"],
      ["/api/audit-logs/reviews", "POST"],
      [`/api/approvals/${id}/timeline`, "GET"],
      [`/api/approvals/${id}/print-log`, "POST"],
    ] as const) {
      const res = await anon.request(path, { method, body: method === "POST" ? {} : undefined });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });
});

describe("보안 리뷰 반영 (M6)", () => {
  it("본문을 열람할 수 없는 관리자에게 감사 로그가 문서 제목·결재 의견·첨부 이름을 보이지 않는다", async () => {
    const title = `비밀 제목 ${Date.now().toString(36)}`;
    const id = await submittedDoc({ title });
    const v = await json<View>(await req("member1", `/api/approvals/${id}`));
    const step = v.steps.find((s) => s.status === "ACTIVE");
    const act = await req("member2", `/api/approvals/${id}/steps/${step?.id}/act`, "POST", {
      action: { kind: "reject", comment: "극비 결재 의견" },
      idempotencyKey: key(),
      expectedVersion: step?.version,
    });
    expect(act.status).toBe(200);

    type Row = LogPage["items"][number] & {
      targetLabel: string | null;
      reason: string | null;
      masked: boolean;
    };
    const rows = async (who: string) =>
      (await json<{ items: Row[] }>(await req(who, `/api/audit-logs?targetId=${id}`))).items;

    // 관리자: 누가·언제·무엇을 했는지는 보이지만 제목과 의견 내용은 가려진다
    const adminRows = await rows("admin");
    expect(adminRows.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(adminRows)).not.toContain(title);
    expect(JSON.stringify(adminRows)).not.toContain("극비 결재 의견");
    expect(adminRows.every((r) => r.masked && r.targetLabel === null && r.reason === null)).toBe(
      true,
    );
    expect(adminRows.every((r) => r.actorName && r.action)).toBe(true);

    // 소유자(계정 범위 read_all)는 그대로 본다
    const ownerRows = await rows("owner");
    expect(JSON.stringify(ownerRows)).toContain(title);
    expect(JSON.stringify(ownerRows)).toContain("극비 결재 의견");
    expect(ownerRows.every((r) => !r.masked)).toBe(true);
  });

  it("타임라인에 기안자 전용 의견의 존재가 드러나지 않는다", async () => {
    const id = await submittedDoc();
    const res = await req("member2", `/api/approvals/${id}/comments`, "POST", {
      body: "기안자에게만 하는 말",
      visibility: "drafter",
    });
    expect(res.status).toBeLessThan(300);
    const mine = await timeline("member1", id);
    expect(mine.map((i) => i.label)).not.toContain("의견 등록");
    const audited = await timeline("auditor", id);
    expect(audited.map((i) => i.label)).not.toContain("의견 등록");
  });

  it("인쇄 기록을 짧은 시간에 반복해도 로그가 불어나지 않는다", async () => {
    const id = await submittedDoc();
    const calls = await Promise.all(
      Array.from({ length: 10 }, () => req("member1", `/api/approvals/${id}/print-log`, "POST")),
    );
    expect(calls.every((r) => r.status === 200)).toBe(true);
    expect(await auditRows("document.print", id)).toHaveLength(1);
  });
});
