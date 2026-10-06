import { describe, expect, it } from "vitest";
import {
  coverageFloorRegressions,
  coverageShortfalls,
  isolationLeaks,
  listedFilesOf,
} from "../feature-check";

const ROOT = "/repo";

describe("기능 격리 검사", () => {
  it("자기 폴더·공통 영역·외부 패키지만 컴파일 범위에 있으면 샌다고 보지 않는다", () => {
    const files = [
      "/repo/features/notification/src/service/send.ts",
      "/repo/shared/src/server/http.ts",
      "/repo/packages/db/src/index.ts",
      "/repo/node_modules/zod/index.d.ts",
    ];
    expect(isolationLeaks(files, "notification", ROOT)).toEqual([]);
  });

  it("다른 기능·합성 루트·도구가 범위에 들어오면 잡는다", () => {
    const files = [
      "/repo/features/notification/src/a.ts",
      "/repo/features/backup/src/b.ts",
      "/repo/apps/web/server/app.ts",
      "/repo/tools/src/x.ts",
    ];
    expect(isolationLeaks(files, "notification", ROOT)).toEqual([
      "features/backup/src/b.ts",
      "apps/web/server/app.ts",
      "tools/src/x.ts",
    ]);
  });

  it("tsc 출력에서 파일 줄만 가려낸다", () => {
    const out = [
      "src/a.ts(1,2): error TS2307: Cannot find module 'x'.",
      "/repo/src/a.ts",
      String.raw`C:\repo\src\b.tsx`,
      "",
    ].join("\n");
    expect(listedFilesOf(out)).toEqual(["/repo/src/a.ts", String.raw`C:\repo\src\b.tsx`]);
  });
});

describe("커버리지 하한", () => {
  const floor = { lines: 80, statements: 80, functions: 70, branches: 60 };
  it("하한 이상이면 통과한다", () => {
    expect(
      coverageShortfalls({ lines: 80, statements: 90, functions: 70, branches: 61 }, floor),
    ).toEqual([]);
  });
  it("하한 아래인 지표를 알려 준다", () => {
    expect(
      coverageShortfalls({ lines: 79.9, statements: 90, functions: 70, branches: 10 }, floor),
    ).toEqual([
      { metric: "lines", measured: 79.9, floor: 80 },
      { metric: "branches", measured: 10, floor: 60 },
    ]);
  });
});

describe("커버리지 하한 약화 감지", () => {
  const floor = { lines: 80, statements: 80, functions: 70, branches: 60 };
  it("같거나 오르면 문제없고, 새 기능 추가도 허용한다", () => {
    expect(
      coverageFloorRegressions(
        { a: floor },
        { a: { ...floor, lines: 85 }, b: { lines: 1, statements: 1, functions: 1, branches: 1 } },
      ),
    ).toEqual([]);
  });
  it("낮추거나 지우면 잡는다", () => {
    expect(coverageFloorRegressions({ a: floor }, { a: { ...floor, branches: 50 } })).toEqual([
      "a: 커버리지 하한 branches이 60 → 50로 낮아졌습니다",
    ]);
    expect(coverageFloorRegressions({ a: floor }, {})).toEqual(["a: 커버리지 하한이 사라졌습니다"]);
  });
});
