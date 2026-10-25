"use client";

import { useMe } from "@fmerp/shared/lib/queries";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@fmerp/shared/ui/tabs";
import { useSearchParams } from "next/navigation";
import { type ReactNode, useMemo } from "react";
import { PasskeySection } from "./passkey-section";
import { PinSection } from "./pin-section";
import { ProfileSection } from "./profile-section";
import { LoginHistorySection, SessionsSection } from "./sessions-section";

const TABS = ["profile", "pin", "passkeys", "notify", "sessions", "history"] as const;
type TabValue = (typeof TABS)[number];

/** `notifySection`은 알림 기능의 화면 조각이다. 합성 루트(app/(app)/me/page.tsx)가 끼워 넣는다 */
export function MePage({ notifySection }: { notifySection: ReactNode }) {
  const { data: me } = useMe();
  const requested = useSearchParams().get("tab");
  const tab: TabValue = TABS.includes(requested as TabValue) ? (requested as TabValue) : "profile";
  const tabs = useMemo(
    () => (
      <Tabs key={tab} defaultValue={tab}>
        <TabsList variant="line" className="flex-wrap">
          <TabsTrigger value="profile">프로필</TabsTrigger>
          <TabsTrigger value="pin">결재 PIN</TabsTrigger>
          <TabsTrigger value="passkeys">내 기기</TabsTrigger>
          <TabsTrigger value="notify">알림</TabsTrigger>
          <TabsTrigger value="sessions">세션</TabsTrigger>
          <TabsTrigger value="history">로그인 이력</TabsTrigger>
        </TabsList>
        <TabsContent value="profile">{me ? <ProfileSection me={me} /> : null}</TabsContent>
        <TabsContent value="pin">{me ? <PinSection hasPin={me.hasPin} /> : null}</TabsContent>
        <TabsContent value="passkeys">
          <PasskeySection />
        </TabsContent>
        <TabsContent value="notify">{notifySection}</TabsContent>
        <TabsContent value="sessions">
          <SessionsSection />
        </TabsContent>
        <TabsContent value="history">
          <LoginHistorySection />
        </TabsContent>
      </Tabs>
    ),
    [me, notifySection, tab],
  );
  if (!me) return null;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">내 정보</h1>
      {tabs}
    </div>
  );
}
