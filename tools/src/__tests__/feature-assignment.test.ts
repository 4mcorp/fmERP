import { describe, expect, it } from "vitest";
import { isTestFile, ownerOf } from "../feature-assignment";

describe("기능 배정표", () => {
  it.each([
    ["apps/web/server/approval/service.ts", "approval"],
    ["apps/web/server/routes/forms.ts", "approval"],
    ["apps/web/components/approval/line-editor.tsx", "approval"],
    ["packages/core/src/approval-engine.ts", "approval"],
    ["packages/core/src/form-schema.ts", "shared"],
    ["packages/core/src/form-defaults.ts", "approval"],
    ["packages/core/src/completion-package.ts", "shared"],
    ["features/notification/src/service/send.ts", "notification"],
    ["apps/web/app/(app)/notifications/page.tsx", "composition"],
    ["apps/worker/src/backup-jobs.ts", "backup"],
    ["apps/worker/src/package-jobs.ts", "completion"],
    ["apps/web/server/routes/reauth.ts", "account"],
    ["packages/auth/src/pin.ts", "account"],
    ["apps/web/server/routes/members.ts", "org"],
    ["packages/core/src/department-tree.ts", "org"],
    ["apps/web/server/audit/logs.ts", "audit"],
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
