import { afterAll, describe, expect, it } from "vitest";
import { createDatabase } from "./client";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL이 없습니다");
const { pool } = createDatabase(url);

afterAll(() => pool.end());

describe("초기 마이그레이션 (앱 계정으로 확인)", () => {
  it("ltree·pg_trgm 확장이 설치된다", async () => {
    const { rows } = await pool.query<{ extname: string }>(
      "select extname from pg_extension where extname in ('ltree', 'pg_trgm') order by extname",
    );
    expect(rows.map((r) => r.extname)).toEqual(["ltree", "pg_trgm"]);
  });

  it("PostgreSQL 18 내장 uuidv7()로 시간순 UUID를 만든다 (ADR 0001)", async () => {
    const { rows } = await pool.query<{ a: string; b: string }>(
      "select uuidv7() as a, uuidv7() as b",
    );
    const row = rows[0];
    expect(row?.a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
    expect(row && row.a < row.b).toBe(true);
  });

  it("앱 계정은 public 스키마에 테이블을 만들 수 없다", async () => {
    await expect(pool.query("create table should_fail (id int)")).rejects.toThrow(
      /permission denied/,
    );
  });
});
