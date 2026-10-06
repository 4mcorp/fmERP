import { describe, expect, it } from "vitest";
import {
  expandBraces,
  extractRoutes,
  type FeatureIndex,
  find,
  type IndexedFeature,
  impact,
} from "../feature-map";

const feature = (over: Partial<IndexedFeature>): IndexedFeature => ({
  id: "notification",
  folder: "notification",
  summary: "알림을 만든다",
  keywords: ["알림", "읽음", "텔레그램"],
  access: [{ who: "모든 구성원", path: "앱 헤더 알림 → /notifications" }],
  screens: [{ route: "/notifications", file: "src/ui/pages/notifications.tsx" }],
  adapters: ["apps/web/app/(app)/notifications/page.tsx"],
  routes: [{ method: "get", path: "/notifications", file: "x.ts" }],
  tables: { owns: ["notification"], reads: [], writes: [] },
  ...over,
});

const index: FeatureIndex = {
  features: [
    feature({}),
    feature({
      id: "backup",
      folder: "backup",
      summary: "덤프를 만든다",
      keywords: ["백업", "덤프"],
      access: [],
      screens: [{ route: "/system/backups", file: "src/ui/pages/system-backups.tsx" }],
      routes: [],
      tables: { owns: ["system_backup"], reads: [], writes: [] },
    }),
  ],
};

describe("중괄호 펼치기", () => {
  it("하나 이상의 중괄호를 펼친다", () => {
    expect(expandBraces("a/{b,c}/d.ts")).toEqual(["a/b/d.ts", "a/c/d.ts"]);
    expect(expandBraces("a/{x,y}/{1,2}")).toEqual(["a/x/1", "a/x/2", "a/y/1", "a/y/2"]);
    expect(expandBraces("plain/path.ts")).toEqual(["plain/path.ts"]);
  });
});

describe("라우트 추출", () => {
  it("createRoute의 method·path 쌍을 뽑는다", () => {
    const src = `
      createRoute({ method: "get", path: "/a", tags: [] })
      createRoute({
        method: "post",
        path: "/b/{id}",
      })
    `;
    expect(extractRoutes(src)).toEqual([
      { method: "get", path: "/a" },
      { method: "post", path: "/b/{id}" },
    ]);
  });
});

describe("질의", () => {
  it("키워드가 맞는 기능이 앞에 온다", () => {
    const hits = find(index, "알림 읽음");
    expect(hits[0]?.feature.id).toBe("notification");
    expect(hits.some((h) => h.feature.id === "backup")).toBe(false);
  });
  it("일치가 없으면 빈 목록이다", () => {
    expect(find(index, "없는낱말")).toEqual([]);
  });
});

describe("영향", () => {
  it("기능 파일은 소유 기능과 진입점 여부를 알려 주고, 밖의 파일은 기능이 없다", () => {
    expect(impact(index, "features/notification/src/api/routes.ts").owner).toBe("notification");
    expect(impact(index, "features/notification/src/api/routes.ts").note).toContain("진입점");
    expect(impact(index, "features/notification/src/service/send.ts").note).toContain("내부");
    expect(impact(index, "shared/src/server/http.ts").owner).toBeNull();
  });
});
