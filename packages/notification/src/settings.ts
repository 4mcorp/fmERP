// 서버 설정(system_setting) 읽기·쓰기. 앱 DB 연결(fmerp_app)로 동작한다.
import { type Db, schema } from "@fmerp/db";
import { eq, sql } from "drizzle-orm";

export const RECEIVER_MODES = ["polling", "webhook"] as const;
export type ReceiverMode = (typeof RECEIVER_MODES)[number];

type Key = (typeof schema.SYSTEM_SETTING_KEYS)[number];

async function read(db: Db, key: Key): Promise<unknown> {
  const [row] = await db
    .select({ value: schema.systemSetting.value })
    .from(schema.systemSetting)
    .where(eq(schema.systemSetting.key, key));
  return row?.value;
}

async function write(db: Db, key: Key, value: unknown, userId: string | null = null) {
  await db
    .insert(schema.systemSetting)
    .values({ key, value, updatedByUserId: userId })
    .onConflictDoUpdate({
      target: schema.systemSetting.key,
      set: { value, updatedByUserId: userId, updatedAt: sql`now()` },
    });
}

/** 기본은 폴링이다. 알 수 없는 값도 폴링으로 본다 */
export async function getReceiverMode(db: Db): Promise<ReceiverMode> {
  return (await read(db, "telegram_mode")) === "webhook" ? "webhook" : "polling";
}

export const setReceiverMode = (db: Db, mode: ReceiverMode, userId: string) =>
  write(db, "telegram_mode", mode, userId);

export async function getUpdateOffset(db: Db): Promise<number | undefined> {
  const v = await read(db, "telegram_update_offset");
  return typeof v === "number" ? v : undefined;
}

export const setUpdateOffset = (db: Db, offset: number) =>
  write(db, "telegram_update_offset", offset);

/** worker가 실제로 적용한 수신 방식과 마지막 오류. 시스템 설정 화면이 보여 준다 */
export interface ReceiverStatus {
  mode: ReceiverMode | null;
  error: string | null;
  at: string;
}

export const setReceiverStatus = (db: Db, status: ReceiverStatus) =>
  write(db, "telegram_receiver_status", status);

export async function getReceiverStatus(db: Db): Promise<ReceiverStatus | null> {
  const v = await read(db, "telegram_receiver_status");
  return v && typeof v === "object" ? (v as ReceiverStatus) : null;
}
