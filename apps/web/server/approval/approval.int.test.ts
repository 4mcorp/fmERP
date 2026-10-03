// 결재 엔진 통합 테스트 (실제 DB): 수용 기준 S3·S4, 동시성·멱등·채번·완료 후 불변·대결·테넌트 격리 (M3).
import type { ApprovalAction, DraftLineItem } from "@fmerp/core";
import { createDatabase, schema, withTenant } from "@fmerp/db";
import { and, count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDelegation, revokeDelegation } from "./delegation";
import { ApprovalError } from "./errors";
import {
  actOnStep,
  allocateDocNumber,
  createApproval,
  redraftDocument,
  reopenDocument,
  type ServiceContext,
  submitDocument,
  withdrawDocument,
} from "./service";

const appDb = createDatabase(process.env.DATABASE_URL ?? "");
const authDb = createDatabase(process.env.AUTH_DATABASE_URL ?? "");
afterAll(async () => {
  await appDb.pool.end();
  await authDb.pool.end();
});

const NOW = new Date("2026-10-03T00:00:00Z");

let accountId: string;
let otherAccountId: string;
let businessId: string;
let m: Record<string, string>;

/** drizzle은 PostgreSQL 오류를 cause에 감싸므로 원래 메시지로 확인한다 */
async function expectPgError(promise: Promise<unknown>, pattern: RegExp) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, "오류가 나야 한다").toBeInstanceOf(Error);
  const cause = (error as { cause?: { message?: string } }).cause;
  expect(cause?.message ?? (error as Error).message).toMatch(pattern);
}

async function expectApprovalError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApprovalError);
  expect((error as ApprovalError).code).toBe(code);
}

const run = <T>(fn: (ctx: ServiceContext) => Promise<T>, now: Date = NOW, forAccount?: string) =>
  withTenant(appDb.db, forAccount ?? accountId, (tx) =>
    fn({ tx, accountId: forAccount ?? accountId, now, userId: null, request: { ip: "127.0.0.1" } }),
  );

const user = (email: string): DraftLineItem["target"] => ({
  kind: "user",
  membershipId: m[email] as string,
});
const approve = (
  seq: number,
  email: string,
  extra: Partial<DraftLineItem> = {},
): DraftLineItem => ({
  type: "approve",
  seq,
  target: user(email),
  ...extra,
});

const NUMBERING = (
  departmentCode: string,
  at: "submit" | "complete" = "complete",
  cycle: "year" | "month" | "none" = "year",
) => ({
  rule: "{사업자코드}-{부서코드}-{YYYY}-{SEQ:4}",
  cycle,
  at,
  departmentCode,
  formCode: "EXP",
});

async function newDoc(
  line: DraftLineItem[],
  extra: Record<string, unknown> = {},
  drafter = "member1@example.com",
) {
  return run((ctx) =>
    createApproval(ctx, {
      businessId,
      drafterMembershipId: m[drafter] as string,
      title: "지출결의서",
      body: { amount: 15_000_000 },
      line,
      ...extra,
    }),
  );
}

async function stepsOf(documentId: string) {
  return run((ctx) =>
    ctx.tx
      .select()
      .from(schema.approvalStep)
      .where(eq(schema.approvalStep.documentId, documentId))
      .orderBy(schema.approvalStep.seq, schema.approvalStep.id),
  );
}

async function docOf(documentId: string) {
  const [row] = await run((ctx) =>
    ctx.tx.select().from(schema.document).where(eq(schema.document.id, documentId)),
  );
  if (!row) throw new Error("no doc");
  return row;
}

let keySeq = 0;
const key = () => `k-${++keySeq}-${Math.random().toString(36).slice(2)}`;

/** 활성 단계 중 해당 처리자의 단계를 찾아 처리한다 */
async function step(documentId: string, email: string, action: ApprovalAction, now: Date = NOW) {
  const steps = await stepsOf(documentId);
  const target = steps.find(
    (s) => s.status === "ACTIVE" && s.assigneeIds.includes(m[email] as string),
  );
  if (!target) throw new Error(`활성 단계 없음: ${email}`);
  return run(
    (ctx) =>
      actOnStep(
        ctx,
        documentId,
        target.id,
        action,
        { membershipId: m[email] as string },
        { idempotencyKey: key() },
      ),
    now,
  );
}

beforeAll(async () => {
  const accounts = await authDb.db.select().from(schema.account);
  accountId = accounts.find((a) => a.slug === "fourm-test")?.id ?? "";
  otherAccountId = accounts.find((a) => a.slug === "other-company")?.id ?? "";
  const members = await authDb.db
    .select({
      id: schema.membership.id,
      email: schema.user.email,
      accountId: schema.membership.accountId,
    })
    .from(schema.membership)
    .innerJoin(schema.user, eq(schema.user.id, schema.membership.userId));
  m = Object.fromEntries(
    members.filter((x) => x.accountId === accountId).map((x) => [x.email, x.id]),
  );
  const [fm] = await run((ctx) =>
    ctx.tx
      .select({ id: schema.business.id })
      .from(schema.business)
      .where(eq(schema.business.code, "FM")),
  );
  businessId = fm?.id ?? "";
});

describe("S3: 기안 → 합의(병렬) → 결재 → 감사 → 완료", () => {
  it("순서대로 처리하면 문서번호가 채번되고 COMPLETED가 되며 모든 처리가 기록된다", async () => {
    // 기안자(member1) → 팀장 → 재무팀 합의(병렬 2명 전원) → 본부장 → 감사 → 대표이사(사업자 대표이사 동적 대상)
    const { documentId, warnings } = await newDoc(
      [
        approve(1, "member2@example.com"),
        { type: "agree", seq: 2, target: user("hr@example.com") },
        { type: "agree", seq: 2, target: user("approver@example.com") },
        approve(3, "bizadmin@example.com"),
        { type: "audit", seq: 4, target: user("auditor@example.com") },
        { type: "approve", seq: 5, target: { kind: "business_ceo", businessId } },
      ],
      { numbering: NUMBERING("S3") },
    );
    expect(warnings).toBeDefined();
    await run((ctx) => submitDocument(ctx, documentId, m["member1@example.com"] as string));
    expect((await docOf(documentId)).status).toBe("IN_PROGRESS");

    await step(documentId, "member2@example.com", { kind: "approve" });
    // 병렬 합의: 한 명만 동의해서는 다음 단계로 가지 않는다
    await step(documentId, "hr@example.com", { kind: "agree" });
    expect(
      (await stepsOf(documentId)).find((s) =>
        s.assigneeIds.includes(m["bizadmin@example.com"] as string),
      )?.status,
    ).toBe("PENDING");
    await step(documentId, "approver@example.com", { kind: "agree" });
    await step(documentId, "bizadmin@example.com", { kind: "approve" });
    await step(documentId, "auditor@example.com", { kind: "audit_approve" });
    const last = await step(documentId, "owner@example.com", { kind: "approve" });

    expect(last.doc.status).toBe("COMPLETED");
    const doc = await docOf(documentId);
    expect(doc.status).toBe("COMPLETED");
    expect(doc.docNo).toBe("FM-S3-2026-0001");
    expect(doc.completedAt).toBeTruthy();

    // 처리 기록과 감사 로그, 이벤트
    const actions = await run((ctx) =>
      ctx.tx
        .select()
        .from(schema.approvalAction)
        .where(eq(schema.approvalAction.documentId, documentId)),
    );
    expect(actions.map((a) => a.action).sort()).toEqual(
      ["agree", "agree", "approve", "approve", "approve", "audit_approve"].sort(),
    );
    expect(actions.every((a) => a.ip === "127.0.0.1")).toBe(true);
    const [audit] = await authDb.db
      .select({ n: count() })
      .from(schema.auditLog)
      .where(
        and(eq(schema.auditLog.targetId, documentId), eq(schema.auditLog.accountId, accountId)),
      );
    expect(audit?.n).toBeGreaterThanOrEqual(8); // 생성 + 상신 + 처리 6
    const events = await run((ctx) =>
      ctx.tx
        .select({ type: schema.approvalEvent.type })
        .from(schema.approvalEvent)
        .where(eq(schema.approvalEvent.documentId, documentId)),
    );
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining(["submitted", "step_activated", "completed"]),
    );
  });

  it("동적 대상(기안자 부서장)은 DB의 부서장 지정으로 해석된다", async () => {
    const [fin] = await run((ctx) =>
      ctx.tx
        .select({ id: schema.department.id })
        .from(schema.department)
        .where(eq(schema.department.code, "FIN")),
    );
    await run((ctx) =>
      ctx.tx
        .update(schema.department)
        .set({ headMembershipId: m["member2@example.com"] })
        .where(eq(schema.department.id, fin?.id ?? "")),
    );
    try {
      const { documentId } = await newDoc([
        { type: "approve", seq: 1, target: { kind: "drafter_head" } },
      ]);
      const steps = await stepsOf(documentId);
      expect(steps[0]?.assigneeIds).toEqual([m["member2@example.com"]]);
      // 처리자 스냅샷: 결재 시점의 이름·직위 (ORG-017)
      expect(steps[0]?.assigneeSnapshot[0]).toMatchObject({
        name: "최대리",
        positionName: "대리",
        dutyName: "팀장",
      });
    } finally {
      await run((ctx) =>
        ctx.tx
          .update(schema.department)
          .set({ headMembershipId: null })
          .where(eq(schema.department.id, fin?.id ?? "")),
      );
    }
  });
});

describe("S4: 반려와 재기안", () => {
  it("본부장이 사유를 적어 반려하면 REJECTED, 재기안은 원문과 연결된 새 초안이다", async () => {
    const { documentId } = await newDoc([
      approve(1, "member2@example.com"),
      approve(2, "bizadmin@example.com"),
    ]);
    await run((ctx) => submitDocument(ctx, documentId, m["member1@example.com"] as string));
    await step(documentId, "member2@example.com", { kind: "approve" });
    // 사유 없이는 반려할 수 없다
    await expectApprovalError(
      step(documentId, "bizadmin@example.com", { kind: "reject", comment: "" }),
      "comment_required",
    );
    await step(documentId, "bizadmin@example.com", { kind: "reject", comment: "금액 근거 부족" });
    expect((await docOf(documentId)).status).toBe("REJECTED");

    const redraft = await run((ctx) =>
      redraftDocument(ctx, documentId, m["member1@example.com"] as string),
    );
    const copy = await docOf(redraft.documentId);
    expect(copy.status).toBe("DRAFT");
    expect(copy.supersedes).toBe(documentId);
    expect(copy.body).toEqual({ amount: 15_000_000 });
    expect((await stepsOf(redraft.documentId)).every((s) => s.status === "PENDING")).toBe(true);
    // 반려되지 않은 문서는 재기안할 수 없다
    await expectApprovalError(
      run((ctx) => redraftDocument(ctx, redraft.documentId, m["member1@example.com"] as string)),
      "invalid_state",
    );
  });

  it("회수는 첫 처리 전에만, 회수 후 초안으로 되돌려 다시 상신할 수 있다", async () => {
    const { documentId } = await newDoc([approve(1, "member2@example.com")]);
    await run((ctx) => submitDocument(ctx, documentId, m["member1@example.com"] as string));
    await expectApprovalError(
      run((ctx) => withdrawDocument(ctx, documentId, m["member2@example.com"] as string)),
      "not_assignee",
    );
    await run((ctx) => withdrawDocument(ctx, documentId, m["member1@example.com"] as string));
    expect((await docOf(documentId)).status).toBe("WITHDRAWN");
    await run((ctx) => reopenDocument(ctx, documentId, m["member1@example.com"] as string));
    await run((ctx) => submitDocument(ctx, documentId, m["member1@example.com"] as string));
    await step(documentId, "member2@example.com", { kind: "approve" });
    await expectApprovalError(
      run((ctx) => withdrawDocument(ctx, documentId, m["member1@example.com"] as string)),
      "cannot_withdraw",
    );
  });
});

describe("동시성·멱등 (APV-045)", () => {
  it("같은 단계를 두 요청이 동시에 처리하면 한쪽만 반영된다", async () => {
    const { documentId } = await newDoc([
      approve(1, "member2@example.com"),
      approve(2, "bizadmin@example.com"),
    ]);
    await run((ctx) => submitDocument(ctx, documentId, m["member1@example.com"] as string));
    const [s1] = await stepsOf(documentId);
    const attempt = () =>
      run((ctx) =>
        actOnStep(
          ctx,
          documentId,
          s1?.id ?? "",
          { kind: "approve" },
          { membershipId: m["member2@example.com"] as string },
          { idempotencyKey: key() },
        ),
      ).then(
        () => "ok",
        (e: unknown) => (e as ApprovalError).code,
      );
    const results = await Promise.all([attempt(), attempt()]);
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
    expect(results.find((r) => r !== "ok")).toMatch(/step_not_active|version_conflict/);
    const actions = await run((ctx) =>
      ctx.tx
        .select()
        .from(schema.approvalAction)
        .where(eq(schema.approvalAction.stepId, s1?.id ?? "")),
    );
    expect(actions).toHaveLength(1);
  });

  it("병렬 그룹의 두 처리가 동시에 와도 서로의 결과를 놓치지 않고 다음 단계가 열린다", async () => {
    const { documentId } = await newDoc([
      { type: "agree", seq: 1, target: user("hr@example.com") },
      { type: "agree", seq: 1, target: user("approver@example.com") },
      approve(2, "member2@example.com"),
    ]);
    await run((ctx) => submitDocument(ctx, documentId, m["member1@example.com"] as string));
    await Promise.all([
      step(documentId, "hr@example.com", { kind: "agree" }),
      step(documentId, "approver@example.com", { kind: "agree" }),
    ]);
    const steps = await stepsOf(documentId);
    expect(steps.map((s) => s.status)).toEqual(["APPROVED", "APPROVED", "ACTIVE"]);
  });

  it("같은 멱등 키로 다시 요청하면 한 번만 처리하고 같은 결과를 돌려준다", async () => {
    const { documentId } = await newDoc([
      approve(1, "member2@example.com"),
      approve(2, "bizadmin@example.com"),
    ]);
    await run((ctx) => submitDocument(ctx, documentId, m["member1@example.com"] as string));
    const [s1] = await stepsOf(documentId);
    const k = key();
    const go = () =>
      run((ctx) =>
        actOnStep(
          ctx,
          documentId,
          s1?.id ?? "",
          { kind: "approve" },
          { membershipId: m["member2@example.com"] as string },
          { idempotencyKey: k },
        ),
      );
    const first = await go();
    const second = await go();
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.doc.steps[0]?.status).toBe("APPROVED");
    const actions = await run((ctx) =>
      ctx.tx
        .select()
        .from(schema.approvalAction)
        .where(eq(schema.approvalAction.stepId, s1?.id ?? "")),
    );
    expect(actions).toHaveLength(1);
  });

  it("낙관적 잠금: 오래된 version으로 요청하면 충돌", async () => {
    const { documentId } = await newDoc([approve(1, "member2@example.com")]);
    await run((ctx) => submitDocument(ctx, documentId, m["member1@example.com"] as string));
    const [s1] = await stepsOf(documentId);
    await expectApprovalError(
      run((ctx) =>
        actOnStep(
          ctx,
          documentId,
          s1?.id ?? "",
          { kind: "approve" },
          { membershipId: m["member2@example.com"] as string },
          { idempotencyKey: key(), expectedVersion: (s1?.version ?? 0) - 1 },
        ),
      ),
      "version_conflict",
    );
  });
});

describe("문서번호 채번 (APV-060·061)", () => {
  it("병렬 100건 채번에 누락·중복이 없다", async () => {
    const ids: string[] = [];
    await run(async (ctx) => {
      for (let i = 0; i < 100; i++) {
        const r = await createApproval(ctx, {
          businessId,
          drafterMembershipId: m["member1@example.com"] as string,
          title: `채번 ${i}`,
          line: [approve(1, "member2@example.com")],
          numbering: NUMBERING("N100", "submit"),
        });
        ids.push(r.documentId);
      }
    });
    await Promise.all(
      ids.map((id) => run((ctx) => submitDocument(ctx, id, m["member1@example.com"] as string))),
    );
    const rows = await run((ctx) =>
      ctx.tx
        .select({ docNo: schema.document.docNo })
        .from(schema.document)
        .where(eq(schema.document.title, "채번 0")),
    );
    expect(rows).toHaveLength(1);
    const all = await Promise.all(ids.map((id) => docOf(id)));
    const seqs = all.map((d) => Number((d.docNo ?? "").split("-").pop())).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(new Set(all.map((d) => d.docNo)).size).toBe(100);
  });

  it("롤백되면 번호도 되돌아가 빈 번호가 생기지 않는다", async () => {
    const numbering = NUMBERING("RB", "complete");
    await expect(
      run(async (ctx) => {
        await allocateDocNumber(ctx, businessId, numbering);
        throw new Error("롤백");
      }),
    ).rejects.toThrow("롤백");
    expect(await run((ctx) => allocateDocNumber(ctx, businessId, numbering))).toBe(
      "FM-RB-2026-0001",
    );
  });

  it("초기화 주기: 월이 바뀌면 새 시리즈로 1부터 시작한다", async () => {
    const numbering = NUMBERING("MC", "complete", "month");
    const oct = await run(
      (ctx) => allocateDocNumber(ctx, businessId, numbering),
      new Date("2026-10-03T00:00:00Z"),
    );
    const oct2 = await run(
      (ctx) => allocateDocNumber(ctx, businessId, numbering),
      new Date("2026-10-20T00:00:00Z"),
    );
    const nov = await run(
      (ctx) => allocateDocNumber(ctx, businessId, numbering),
      new Date("2026-11-02T00:00:00Z"),
    );
    expect([oct, oct2, nov]).toEqual(["FM-MC-2026-0001", "FM-MC-2026-0002", "FM-MC-2026-0001"]);
  });

  it("잘못된 규칙은 거부한다", async () => {
    await expectApprovalError(
      run((ctx) =>
        allocateDocNumber(ctx, businessId, { ...NUMBERING("X"), rule: "{없는토큰}-{SEQ:4}" }),
      ),
      "rule_invalid",
    );
  });
});

describe("완료 후 불변·추가 전용 (APV-046·062)", () => {
  let doneId: string;
  beforeAll(async () => {
    const { documentId } = await newDoc([
      approve(1, "member2@example.com"),
      { type: "post", seq: 9, target: user("bizadmin@example.com") },
    ]);
    await run((ctx) => submitDocument(ctx, documentId, m["member1@example.com"] as string));
    await step(documentId, "member2@example.com", { kind: "approve" });
    doneId = documentId;
  });

  it("완료된 문서의 본문·결재선을 DB에 직접 써도 거부된다", async () => {
    expect((await docOf(doneId)).status).toBe("COMPLETED");
    await expectPgError(
      run((ctx) =>
        ctx.tx.update(schema.document).set({ title: "변조" }).where(eq(schema.document.id, doneId)),
      ),
      /내용은 바꿀 수 없습니다/,
    );
    await expectPgError(
      run((ctx) =>
        ctx.tx
          .update(schema.document)
          .set({ body: { amount: 1 } })
          .where(eq(schema.document.id, doneId)),
      ),
      /내용은 바꿀 수 없습니다/,
    );
    await expectPgError(
      run((ctx) =>
        ctx.tx
          .update(schema.document)
          .set({ status: "DRAFT" })
          .where(eq(schema.document.id, doneId)),
      ),
      /바꿀 수 없습니다/,
    );
    await expectPgError(
      run((ctx) => ctx.tx.delete(schema.document).where(eq(schema.document.id, doneId))),
      /삭제할 수 없습니다/,
    );
    const [first] = await stepsOf(doneId);
    await expectPgError(
      run((ctx) =>
        ctx.tx
          .update(schema.approvalStep)
          .set({ status: "REJECTED" })
          .where(eq(schema.approvalStep.id, first?.id ?? "")),
      ),
      /결재선은 변경할 수 없습니다/,
    );
    await expectPgError(
      run((ctx) =>
        ctx.tx
          .update(schema.approvalStep)
          .set({ assigneeIds: [m["owner@example.com"] as string] })
          .where(eq(schema.approvalStep.id, first?.id ?? "")),
      ),
      /변경할 수 없습니다/,
    );
    await expectPgError(
      run((ctx) =>
        ctx.tx.delete(schema.approvalStep).where(eq(schema.approvalStep.id, first?.id ?? "")),
      ),
      /삭제할 수 없습니다/,
    );
    await expectPgError(
      run((ctx) =>
        ctx.tx.insert(schema.approvalStep).values({
          accountId,
          documentId: doneId,
          seq: 10,
          type: "approve",
          assigneeIds: [m["owner@example.com"] as string],
        }),
      ),
      /초안 상태에서만/,
    );
  });

  it("엔진도 완료 문서의 일반 처리를 거부하고, 후결 승인만 허용한다", async () => {
    const steps = await stepsOf(doneId);
    const first = steps.find((s) => s.type === "approve");
    await expectApprovalError(
      run((ctx) =>
        actOnStep(
          ctx,
          doneId,
          first?.id ?? "",
          { kind: "approve" },
          { membershipId: m["member2@example.com"] as string },
          { idempotencyKey: key() },
        ),
      ),
      "invalid_state",
    );
    const post = steps.find((s) => s.type === "post");
    expect(post?.status).toBe("POST_PENDING");
    await expectApprovalError(
      run((ctx) =>
        actOnStep(
          ctx,
          doneId,
          post?.id ?? "",
          { kind: "post_approve" },
          { membershipId: m["member2@example.com"] as string },
          { idempotencyKey: key() },
        ),
      ),
      "not_assignee",
    );
    await run((ctx) =>
      actOnStep(
        ctx,
        doneId,
        post?.id ?? "",
        { kind: "post_approve" },
        { membershipId: m["bizadmin@example.com"] as string },
        { idempotencyKey: key() },
      ),
    );
    expect((await stepsOf(doneId)).find((s) => s.type === "post")?.status).toBe("POST_APPROVED");
    expect((await docOf(doneId)).status).toBe("COMPLETED");
  });

  it("처리 기록·이벤트는 추가만 가능하다 (UPDATE·DELETE 권한 없음)", async () => {
    await expectPgError(
      run((ctx) => ctx.tx.update(schema.approvalAction).set({ comment: "변조" })),
      /permission denied/,
    );
    await expectPgError(
      run((ctx) => ctx.tx.delete(schema.approvalAction)),
      /permission denied/,
    );
    await expectPgError(
      run((ctx) => ctx.tx.update(schema.approvalEvent).set({ type: "x" })),
      /permission denied/,
    );
    await expectPgError(
      run((ctx) => ctx.tx.delete(schema.approvalEvent)),
      /permission denied/,
    );
  });

  it("상신된 문서의 내용은 회수 전에는 바꿀 수 없고, 초안은 바꿀 수 있다", async () => {
    const { documentId } = await newDoc([approve(1, "member2@example.com")]);
    await run((ctx) =>
      ctx.tx
        .update(schema.document)
        .set({ title: "초안 수정" })
        .where(eq(schema.document.id, documentId)),
    );
    await run((ctx) => submitDocument(ctx, documentId, m["member1@example.com"] as string));
    await expectPgError(
      run((ctx) =>
        ctx.tx
          .update(schema.document)
          .set({ title: "상신 후 수정" })
          .where(eq(schema.document.id, documentId)),
      ),
      /회수 후 수정/,
    );
    await expectPgError(
      run((ctx) => ctx.tx.delete(schema.document).where(eq(schema.document.id, documentId))),
      /삭제할 수 없습니다/,
    );
  });
});

describe("처리 권한과 결재선 검증", () => {
  it("처리자가 아니거나 차례가 아니면 거부된다", async () => {
    const { documentId } = await newDoc([
      approve(1, "member2@example.com"),
      approve(2, "bizadmin@example.com"),
    ]);
    await run((ctx) => submitDocument(ctx, documentId, m["member1@example.com"] as string));
    const [s1, s2] = await stepsOf(documentId);
    await expectApprovalError(
      run((ctx) =>
        actOnStep(
          ctx,
          documentId,
          s1?.id ?? "",
          { kind: "approve" },
          { membershipId: m["bizadmin@example.com"] as string },
          { idempotencyKey: key() },
        ),
      ),
      "not_assignee",
    );
    await expectApprovalError(
      run((ctx) =>
        actOnStep(
          ctx,
          documentId,
          s2?.id ?? "",
          { kind: "approve" },
          { membershipId: m["bizadmin@example.com"] as string },
          { idempotencyKey: key() },
        ),
      ),
      "step_not_active",
    );
    await expectApprovalError(
      run((ctx) => submitDocument(ctx, documentId, m["member2@example.com"] as string)),
      "forbidden",
    );
  });

  it("비활성 사용자·본인만 있는 결재선은 상신 전에 막힌다", async () => {
    await expectApprovalError(newDoc([approve(1, "left@example.com")]), "line_invalid");
    await expectApprovalError(newDoc([approve(1, "member1@example.com")]), "line_invalid");
    await expectApprovalError(newDoc([]), "line_invalid");
  });

  it("같은 사람이 중복되면 기본은 거부, 허용 설정이면 경고와 함께 통과한다", async () => {
    const dup = [
      approve(1, "member2@example.com"),
      approve(2, "bizadmin@example.com"),
      approve(3, "member2@example.com"),
    ];
    await expectApprovalError(newDoc(dup), "line_invalid");
    const ok = await newDoc(dup, { allowDuplicate: true });
    expect(ok.warnings.join()).toMatch(/중복/);
  });

  it("다른 계정의 문서는 존재하지 않는 것처럼 보인다 (테넌트 격리)", async () => {
    const { documentId } = await newDoc([approve(1, "member2@example.com")]);
    await expectApprovalError(
      run(
        (ctx) => submitDocument(ctx, documentId, m["member1@example.com"] as string),
        NOW,
        otherAccountId,
      ),
      "not_found",
    );
  });
});

describe("대결 (APV-050·051·053)", () => {
  it("부재 중 대결자가 처리하면 DELEGATED와 대결 기록이 남고, 연쇄 위임은 설정할 수 없다", async () => {
    const from = new Date("2026-10-01T00:00:00Z");
    const to = new Date("2026-10-31T00:00:00Z");
    const created = await run((ctx) =>
      createDelegation(ctx, {
        membershipId: m["approver@example.com"] as string,
        delegateMembershipId: m["hr@example.com"] as string,
        from,
        to,
        scope: { kind: "all" },
        reason: "휴가",
      }),
    );
    expect(created.id).toBeTruthy();

    const { documentId } = await newDoc([approve(1, "approver@example.com")]);
    await run((ctx) => submitDocument(ctx, documentId, m["member1@example.com"] as string));
    expect((await stepsOf(documentId))[0]?.delegates).toEqual({
      [m["approver@example.com"] as string]: m["hr@example.com"],
    });
    const [active] = await stepsOf(documentId);
    const done = await run((ctx) =>
      actOnStep(
        ctx,
        documentId,
        active?.id ?? "",
        { kind: "approve" },
        { membershipId: m["hr@example.com"] as string },
        { idempotencyKey: key() },
      ),
    );
    expect(done.doc.steps[0]?.status).toBe("DELEGATED");
    const [action] = await run((ctx) =>
      ctx.tx
        .select()
        .from(schema.approvalAction)
        .where(eq(schema.approvalAction.documentId, documentId)),
    );
    expect(action).toMatchObject({
      actorMembershipId: m["hr@example.com"],
      onBehalfOfMembershipId: m["approver@example.com"],
    });

    // 연쇄 위임 금지(APV-053): 대결자(hr)가 같은 기간 다른 사람에게 위임, 또는 제3자가 approver에게 위임
    await expectApprovalError(
      run((ctx) =>
        createDelegation(ctx, {
          membershipId: m["hr@example.com"] as string,
          delegateMembershipId: m["auditor@example.com"] as string,
          from,
          to,
          scope: { kind: "all" },
        }),
      ),
      "delegation_invalid",
    );
    await expectApprovalError(
      run((ctx) =>
        createDelegation(ctx, {
          membershipId: m["auditor@example.com"] as string,
          delegateMembershipId: m["approver@example.com"] as string,
          from,
          to,
          scope: { kind: "all" },
        }),
      ),
      "delegation_invalid",
    );
    // 퇴사자는 대결자가 될 수 없다
    await expectApprovalError(
      run((ctx) =>
        createDelegation(ctx, {
          membershipId: m["auditor@example.com"] as string,
          delegateMembershipId: m["left@example.com"] as string,
          from: new Date("2027-01-01T00:00:00Z"),
          to: new Date("2027-01-02T00:00:00Z"),
          scope: { kind: "all" },
        }),
      ),
      "delegation_invalid",
    );
  });

  it("원 결재자와 대결자가 동시에 처리하면 먼저 처리한 쪽만 반영된다", async () => {
    // 위 테스트의 부재 설정(approver → hr)이 10월 전체에 걸쳐 있다
    const { documentId } = await newDoc([
      approve(1, "approver@example.com"),
      approve(2, "member2@example.com"),
    ]);
    await run((ctx) => submitDocument(ctx, documentId, m["member1@example.com"] as string));
    const [s1] = await stepsOf(documentId);
    const go = (who: string) =>
      run((ctx) =>
        actOnStep(
          ctx,
          documentId,
          s1?.id ?? "",
          { kind: "approve" },
          { membershipId: m[who] as string },
          { idempotencyKey: key() },
        ),
      ).then(
        () => who,
        () => "fail",
      );
    const results = await Promise.all([go("approver@example.com"), go("hr@example.com")]);
    expect(results.filter((r) => r !== "fail")).toHaveLength(1);
  });
});

describe("진행 중 단계의 대결자 갱신 (APV-052)", () => {
  it("이미 차례가 온 뒤에 부재가 설정·취소되어도 대결자가 즉시 반영된다", async () => {
    const { documentId } = await newDoc([approve(1, "auditor@example.com")]);
    await run((ctx) => submitDocument(ctx, documentId, m["member1@example.com"] as string));
    const [before] = await stepsOf(documentId);
    expect(before?.delegates).toEqual({});

    const from = new Date("2026-10-02T00:00:00Z");
    const to = new Date("2026-10-04T00:00:00Z");
    const { id } = await run((ctx) =>
      createDelegation(ctx, {
        membershipId: m["auditor@example.com"] as string,
        delegateMembershipId: m["hr@example.com"] as string,
        from,
        to,
        scope: { kind: "all" },
      }),
    );
    const [after] = await stepsOf(documentId);
    expect(after?.delegates).toEqual({ [m["auditor@example.com"] as string]: m["hr@example.com"] });
    expect(after?.version).toBe((before?.version ?? 0) + 1);

    // 취소하면 대결자가 사라지고, 대결자는 더 이상 처리할 수 없다
    await run((ctx) => revokeDelegation(ctx, id));
    const [revoked] = await stepsOf(documentId);
    expect(revoked?.delegates).toEqual({});
    await expectApprovalError(
      run((ctx) =>
        actOnStep(
          ctx,
          documentId,
          revoked?.id ?? "",
          { kind: "approve" },
          { membershipId: m["hr@example.com"] as string },
          { idempotencyKey: key() },
        ),
      ),
      "not_assignee",
    );
  });
});

describe("테넌트 격리 (PERM-002) — 결재 테이블", () => {
  const tables = {
    document: schema.document,
    approval_step: schema.approvalStep,
    approval_action: schema.approvalAction,
    approval_event: schema.approvalEvent,
    doc_number_series: schema.docNumberSeries,
    delegation: schema.delegation,
  } as const;

  for (const [name, table] of Object.entries(tables)) {
    it(`${name}: 테넌트를 지정하지 않으면 0행이고 다른 계정으로는 보이지 않는다`, async () => {
      expect(await appDb.db.select().from(table)).toHaveLength(0);
      const theirs = await withTenant(appDb.db, otherAccountId, (tx) => tx.select().from(table));
      expect(theirs).toHaveLength(0);
      const mine = await run((ctx) => ctx.tx.select().from(table));
      for (const row of mine) expect((row as { accountId: string }).accountId).toBe(accountId);
    });
  }
});
