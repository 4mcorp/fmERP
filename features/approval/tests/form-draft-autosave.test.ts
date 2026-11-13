import { ApiProblem } from "@fmerp/shared/lib/api";
import { describe, expect, it } from "vitest";
import {
  type DraftStatus,
  FormDraftAutosave,
  type FormDraftValue,
} from "../src/ui/form-draft-autosave";

const first: FormDraftValue = {
  schema: { fields: [{ key: "body", label: "내용", type: "text" }] },
  layout: { blocks: [{ kind: "field", key: "body" }] },
};
const change = (label: string): FormDraftValue => ({
  ...first,
  schema: { fields: [{ key: "body", label, type: "text" }] },
});

describe("초안 저장 세션", () => {
  it("전송 전 수정 취소는 저장 완료로 돌아가며 요청을 만들지 않는다", async () => {
    const statuses: DraftStatus[] = [];
    let calls = 0;
    const session = new FormDraftAutosave(
      0,
      first,
      async (value) => {
        calls++;
        return {
          draft: { ...value, revision: 1, updatedAt: "2026-11-02T00:00:00Z" },
          warnings: [],
        };
      },
      (status) => statuses.push(status),
    );
    session.update(change("수정"));
    session.update(first);
    await session.flush();
    expect(calls).toBe(0);
    expect(statuses.at(-1)).toEqual({ kind: "saved", warnings: [] });
  });
  it("변경 없는 로드는 저장하지 않고 연속 입력을 응답 revision으로 직렬 저장한다", async () => {
    const calls: Array<{ revision: number; label: string }> = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const statuses: DraftStatus[] = [];
    const session = new FormDraftAutosave(
      4,
      first,
      async (value) => {
        calls.push({ revision: value.revision, label: value.schema.fields[0]?.label ?? "" });
        if (calls.length === 1) await gate;
        return {
          draft: { ...value, revision: value.revision + 1, updatedAt: "2026-11-02T00:00:00Z" },
          warnings: ["좁은 열"],
        };
      },
      (status) => statuses.push(status),
    );
    await session.flush();
    expect(calls).toEqual([]);
    session.update(change("첫 입력"));
    const saving = session.flush();
    session.update(change("마지막 입력"));
    const queued = session.flush();
    release();
    await Promise.all([saving, queued]);
    expect(calls).toEqual([
      { revision: 4, label: "첫 입력" },
      { revision: 5, label: "마지막 입력" },
    ]);
    expect(statuses.at(-1)).toEqual({ kind: "saved", warnings: ["좁은 열"] });
  });
  it("409는 편집 내용을 보존하며 자동 재시도와 공개를 막는다", async () => {
    const calls: FormDraftValue[] = [];
    const statuses: DraftStatus[] = [];
    const session = new FormDraftAutosave(
      2,
      first,
      async (value) => {
        calls.push(value);
        throw new ApiProblem(409, "revision_conflict", "내용을 복사하고 다시 불러오세요");
      },
      (status) => statuses.push(status),
    );
    session.update(change("내 내용"));
    await expect(session.flush()).rejects.toThrow();
    session.update(change("충돌 후 내용"));
    await expect(session.retry()).rejects.toThrow();
    expect(calls).toHaveLength(1);
    expect(statuses.at(-1)).toEqual({
      kind: "conflict",
      message: "내용을 복사하고 다시 불러오세요",
      warnings: [],
    });
  });
  it("네트워크 실패는 같은 revision으로 명시적 재시도하고 잘못된 구조는 전송하지 않는다", async () => {
    const revisions: number[] = [];
    const session = new FormDraftAutosave(
      0,
      first,
      async (value) => {
        revisions.push(value.revision);
        if (revisions.length === 1) throw new Error("offline");
        return {
          draft: { ...value, revision: 1, updatedAt: "2026-11-02T00:00:00Z" },
          warnings: [],
        };
      },
      () => {},
    );
    session.update(change("수정"), false);
    await expect(session.flush()).rejects.toThrow();
    expect(revisions).toEqual([]);
    session.update(change("수정"));
    await expect(session.flush()).rejects.toThrow();
    await session.retry();
    expect(revisions).toEqual([0, 0]);
  });
});
