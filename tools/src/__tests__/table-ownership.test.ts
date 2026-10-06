import { describe, expect, it } from "vitest";
import {
  collectAccesses,
  evaluateOwnership,
  parseMapList,
  parseSchemaTables,
} from "../table-ownership";

const SCHEMA = `
import { pgTable } from "drizzle-orm/pg-core";
/** 문서 @owner approval */
export const document = pgTable("document", {});
/**
 * 알림
 *
 * @owner notification
 */
export const notification = pgTable("notification", {});
export const orphan = pgTable("orphan_table", {});
`;

describe("스키마 @owner 읽기", () => {
  it("표 이름·소유자를 읽고, 주석이 없으면 null이다", () => {
    const t = parseSchemaTables("s.ts", SCHEMA);
    expect(t.map((x) => [x.exportName, x.sqlName, x.owner])).toEqual([
      ["document", "document", "approval"],
      ["notification", "notification", "notification"],
      ["orphan", "orphan_table", null],
    ]);
  });
});

describe("표 접근 수집", () => {
  const tables = new Set(["document", "notification"]);
  it("insert·update·delete는 쓰기, 그 밖은 읽기로 센다", () => {
    const src = `
      await tx.insert(schema.document).values({});
      await tx.update(schema.notification).set({});
      const rows = await tx.select().from(schema.document);
    `;
    expect(collectAccesses("f.ts", src, tables)).toEqual([
      { exportName: "document", kind: "write" },
      { exportName: "notification", kind: "write" },
      { exportName: "document", kind: "read" },
    ]);
  });
  it("별칭(const A = schema.x)을 따라가 쓰기를 잡는다", () => {
    const src = `const D = schema.document; await tx.delete(D).where(x);`;
    expect(collectAccesses("f.ts", src, tables)).toEqual([
      { exportName: "document", kind: "read" },
      { exportName: "document", kind: "write" },
    ]);
  });
});

describe("feature.map.yaml 목록", () => {
  it("한 줄 목록을 읽는다", () => {
    const y = "tables:\n  owns: {}\n  reads: [a, b_c]   # 설명\n  writes: [d]\n";
    expect(parseMapList(y, "reads")).toEqual(["a", "b_c"]);
    expect(parseMapList(y, "writes")).toEqual(["d"]);
    expect(parseMapList("", "reads")).toEqual([]);
  });
});

describe("소유권 판정", () => {
  const tables = parseSchemaTables(
    "s.ts",
    SCHEMA.replace("export const orphan", "// x\nexport const orphan"),
  );
  const base = {
    tables: tables.map((t) => (t.owner ? t : { ...t, owner: "shared" })),
    features: ["approval", "notification"],
    declared: {
      approval: { reads: [], writes: [] },
      notification: { reads: ["document"], writes: [] },
    },
    migrations: [],
    migrationExemptUpTo: 21,
  };
  const acc = (feature: string, exportName: string, kind: "read" | "write") => ({
    feature,
    file: "x.ts",
    access: { exportName, kind },
  });

  it("소유 표 접근과 선언한 읽기는 통과한다", () => {
    expect(
      evaluateOwnership({
        ...base,
        accesses: [acc("approval", "document", "write"), acc("notification", "document", "read")],
      }),
    ).toEqual([]);
  });
  it("다른 기능 표의 쓰기·선언 없는 읽기를 잡는다", () => {
    expect(
      evaluateOwnership({
        ...base,
        accesses: [
          acc("notification", "document", "write"),
          acc("approval", "notification", "read"),
        ],
      }).sort(),
    ).toEqual(["read:approval:notification", "write:notification:document"]);
  });
  it("@owner가 없는 표와 알 수 없는 소유자를 잡는다", () => {
    const t = [
      { exportName: "a", sqlName: "a", owner: null, file: "s.ts" },
      { exportName: "b", sqlName: "b", owner: "ghost", file: "s.ts" },
    ];
    expect(evaluateOwnership({ ...base, tables: t, accesses: [] })).toEqual([
      "missing-owner:a",
      "bad-owner:b:ghost",
    ]);
  });
  it("새 마이그레이션은 feature 태그가 필요하고 오래된 것은 면제한다", () => {
    expect(
      evaluateOwnership({
        ...base,
        accesses: [],
        migrations: [
          { name: "0021_old.sql", firstLine: "CREATE TABLE" },
          { name: "0022_new.sql", firstLine: "CREATE TABLE" },
          { name: "0023_ok.sql", firstLine: "-- feature: notification" },
        ],
      }),
    ).toEqual(["migration-tag:0022_new.sql"]);
  });
});
