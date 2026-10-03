import Dexie, { type EntityTable } from "dexie";

/**
 * 기안 작성 중인 내용의 브라우저 로컬 사본 (PRD BAK-001, APV-011).
 * 네트워크가 끊겨도 입력이 사라지지 않게 하고, 다시 접속하면 복구 여부를 묻는다.
 * 사용자·계정별로 분리하고, 로그아웃할 때 모두 지운다.
 */
export interface LocalDraft {
  /** `${userId}:${accountId}:${documentId}` */
  id: string;
  userId: string;
  accountId: string;
  documentId: string;
  title: string;
  values: Record<string, unknown>;
  /** 이 사본을 만들 때 서버에 저장되어 있던 리비전 */
  baseRevision: number;
  updatedAt: number;
}

class DraftDb extends Dexie {
  drafts!: EntityTable<LocalDraft, "id">;

  constructor() {
    super("fmerp-local-drafts");
    this.version(1).stores({ drafts: "id, userId, accountId, documentId, updatedAt" });
  }
}

let db: DraftDb | null = null;

function open(): DraftDb | null {
  if (typeof indexedDB === "undefined") return null;
  db ??= new DraftDb();
  return db;
}

const keyOf = (userId: string, accountId: string, documentId: string) =>
  `${userId}:${accountId}:${documentId}`;

/** IndexedDB를 쓸 수 없는 환경(비공개 창 등)에서는 조용히 건너뛴다 */
async function safe<T>(fn: (d: DraftDb) => Promise<T>, fallback: T): Promise<T> {
  try {
    const d = open();
    return d ? await fn(d) : fallback;
  } catch {
    return fallback;
  }
}

export const saveLocalDraft = (draft: Omit<LocalDraft, "id" | "updatedAt">) =>
  safe(async (d) => {
    await d.drafts.put({
      ...draft,
      id: keyOf(draft.userId, draft.accountId, draft.documentId),
      updatedAt: Date.now(),
    });
  }, undefined);

export const loadLocalDraft = (userId: string, accountId: string, documentId: string) =>
  safe((d) => d.drafts.get(keyOf(userId, accountId, documentId)), undefined);

export const removeLocalDraft = (userId: string, accountId: string, documentId: string) =>
  safe((d) => d.drafts.delete(keyOf(userId, accountId, documentId)), undefined);

/** 로그아웃할 때 이 브라우저의 모든 로컬 사본을 지운다 */
export const clearLocalDrafts = () => safe((d) => d.drafts.clear(), undefined);
