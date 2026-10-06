import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyMoves } from "../move";

let root = "";
const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
};
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const rename = (from: string, to: string) =>
  fs.renameSync(path.join(root, from), path.join(root, to));
const FILES = () => {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(rel)) out.push(rel);
    }
  };
  walk("");
  return out;
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "move-fixture-"));
  write(
    "apps/web/server/http.ts",
    'import { problem } from "./problem";\nexport const http = problem;\n',
  );
  write("apps/web/server/problem.ts", "export const problem = 1;\n");
  write("apps/web/server/other.ts", "export const other = 2;\n");
  write(
    "apps/web/server/routes/users.ts",
    'import { http } from "../http";\nimport { other } from "../other";\nexport const u = [http, other];\n',
  );
  write("apps/web/app/page.tsx", 'import { http } from "@/server/http";\nexport default http;\n');
  write(
    "apps/web/server/dyn.test.ts",
    'import { vi } from "vitest";\nvi.mock("./http");\nexport const d = () => import("./problem");\n',
  );
  write("apps/web/components/ui/button.tsx", "export const Button = 1;\n");
  write(
    "apps/web/components/panel.tsx",
    'import { Button } from "@/components/ui/button";\nexport const P = Button;\n',
  );
  write("apps/web/server/index-user.ts", 'import { x } from "./lib";\nexport const y = x;\n');
  write("apps/web/server/lib/index.ts", "export const x = 1;\n");
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("파일 이동과 import 수정", () => {
  it("apps 밖(shared)으로 옮기면 가져오는 쪽은 패키지 지정자를 쓰고, 같이 옮긴 파일끼리는 상대 경로를 유지한다", () => {
    applyMoves(
      root,
      new Map([
        ["apps/web/server/http.ts", "shared/src/server/http.ts"],
        ["apps/web/server/problem.ts", "shared/src/server/problem.ts"],
      ]),
      FILES(),
      rename,
    );
    expect(read("shared/src/server/http.ts")).toContain('from "./problem"');
    expect(read("apps/web/server/routes/users.ts")).toContain('from "@fmerp/shared/server/http"');
    expect(read("apps/web/app/page.tsx")).toContain('from "@fmerp/shared/server/http"');
    // 옮기지 않은 파일 사이의 import는 건드리지 않는다
    expect(read("apps/web/server/routes/users.ts")).toContain('from "../other"');
  });

  it("옮기지 않은 파일을 가리키던 상대 import는 새 위치 기준으로 다시 쓰고, 공통 영역이 apps를 import하면 경고한다", () => {
    const result = applyMoves(
      root,
      new Map([["apps/web/server/http.ts", "shared/src/server/http.ts"]]),
      FILES(),
      rename,
    );
    // http.ts가 ./problem(옮기지 않음)을 가리키므로 apps 쪽 경로로 다시 쓰이고, 경고가 나온다
    expect(read("shared/src/server/http.ts")).toContain("apps/web/server/problem");
    expect(result.warnings.join()).toContain("공통 영역이 apps를 import");
  });

  it("@/ 별칭 import는 apps 안에서는 별칭을 유지한다", () => {
    applyMoves(
      root,
      new Map([["apps/web/server/other.ts", "apps/web/server/routes/other.ts"]]),
      FILES(),
      rename,
    );
    expect(read("apps/web/server/routes/users.ts")).toContain('from "./other"');
    applyMoves(
      root,
      new Map([["apps/web/components/ui/button.tsx", "shared/src/ui/button.tsx"]]),
      FILES(),
      rename,
    );
    expect(read("apps/web/components/panel.tsx")).toContain('from "@fmerp/shared/ui/button"');
  });

  it("vi.mock과 동적 import의 지정자도 고친다", () => {
    applyMoves(
      root,
      new Map([
        ["apps/web/server/http.ts", "shared/src/server/http.ts"],
        ["apps/web/server/problem.ts", "shared/src/server/problem.ts"],
      ]),
      FILES(),
      rename,
    );
    const test = read("apps/web/server/dyn.test.ts");
    expect(test).toContain('vi.mock("@fmerp/shared/server/http")');
    expect(test).toContain('import("@fmerp/shared/server/problem")');
  });

  it("index 파일은 폴더 지정자를 유지한다", () => {
    applyMoves(
      root,
      new Map([["apps/web/server/lib/index.ts", "shared/src/lib/index.ts"]]),
      FILES(),
      rename,
    );
    expect(read("apps/web/server/index-user.ts")).toContain('from "@fmerp/shared/lib"');
  });
});
