import { sql } from "drizzle-orm";
import { timestamp, uuid } from "drizzle-orm/pg-core";

/** 기본 키: PostgreSQL 18 내장 uuidv7() (ADR 0001) */
export const primaryId = () => uuid().primaryKey().default(sql`uuidv7()`);

export const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
