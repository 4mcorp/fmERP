import { describe, expect, it } from "vitest";
import { isTestFile, ownerOf } from "../feature-assignment";

describe("기능 배정표", () => {
  it.each([
    ["features/approval/src/service/service.ts", "approval"],
    ["features/approval/src/api/forms-routes.ts", "approval"],
    ["features/approval/src/ui/components/line-editor.tsx", "approval"],
    ["features/approval/src/domain/approval-engine.ts", "approval"],
    ["packages/core/src/form-schema.ts", "shared"],
    ["features/approval/src/domain/form-defaults.ts", "approval"],
    ["packages/core/src/completion-package.ts", "shared"],
    ["features/notification/src/service/send.ts", "notification"],
    ["apps/web/app/(app)/notifications/page.tsx", "composition"],
    ["features/backup/src/jobs/jobs.ts", "backup"],
    ["features/completion/src/jobs/jobs.ts", "completion"],
    ["apps/worker/src/cli/dump.ts", "composition"],
    ["features/account/src/api/me-routes.ts", "account"],
    ["features/account/src/service/pin.ts", "account"],
    ["features/org/src/api/members-routes.ts", "org"],
    ["features/org/src/domain/department-tree.ts", "org"],
    ["features/audit/src/service/logs.ts", "audit"],
    ["features/home/src/ui/pages/home.tsx", "home"],
    ["apps/web/app/(app)/page.tsx", "composition"],
    ["apps/web/server/app.ts", "composition"],
    ["apps/worker/src/main.ts", "composition"],
    ["packages/db/src/schema/org.ts", "shared"],
    ["packages/audit/src/record.ts", "shared"],
    ["apps/web/components/ui/button.tsx", "shared"],
    ["features/approval/src/service/x.ts", "approval"],
    ["features/org/src/domain/y.ts", "org"],
  ] as const)("%s → %s", (path, owner) => {
    expect(ownerOf(path)).toBe(owner);
  });

  it("규칙이 없는 파일은 null이다 (새 파일은 배정표에 규칙을 추가해야 한다)", () => {
    expect(ownerOf("apps/web/server/brand-new-thing.ts")).toBeNull();
  });

  it("시험·도우미 파일을 구분한다", () => {
    expect(isTestFile("apps/web/server/approval/service.test.ts")).toBe(true);
    expect(isTestFile("apps/web/server/approval/approval.int.test.ts")).toBe(true);
    expect(isTestFile("apps/web/e2e/m4.spec.ts")).toBe(true);
    expect(isTestFile("features/notification/tests/test-support.ts")).toBe(true);
    expect(isTestFile("apps/web/server/approval/service.ts")).toBe(false);
  });
});
