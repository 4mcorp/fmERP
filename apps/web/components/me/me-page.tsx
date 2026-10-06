"use client";

import { useMe } from "@fmerp/shared/lib/queries";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@fmerp/shared/ui/tabs";
import type { ReactNode } from "react";
import { PinSection } from "@/components/me/pin-section";
import { ProfileSection } from "@/components/me/profile-section";
import { LoginHistorySection, SessionsSection } from "@/components/me/sessions-section";

/** `notifySection`은 알림 기능의 화면 조각이다. 합성 루트(app/(app)/me/page.tsx)가 끼워 넣는다 */
export function MePage({ notifySection }: { notifySection: ReactNode }) {
  const { data: me } = useMe();
  if (!me) return null;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">내 정보</h1>
      <Tabs defaultValue="profile">
        <TabsList className="flex-wrap">
          <TabsTrigger value="profile">프로필</TabsTrigger>
          <TabsTrigger value="pin">결재 PIN</TabsTrigger>
          <TabsTrigger value="notify">알림</TabsTrigger>
          <TabsTrigger value="sessions">세션</TabsTrigger>
          <TabsTrigger value="history">로그인 이력</TabsTrigger>
        </TabsList>
        <TabsContent value="profile">
          <ProfileSection me={me} />
        </TabsContent>
        <TabsContent value="pin">
          <PinSection hasPin={me.hasPin} />
        </TabsContent>
        <TabsContent value="notify">{notifySection}</TabsContent>
        <TabsContent value="sessions">
          <SessionsSection />
        </TabsContent>
        <TabsContent value="history">
          <LoginHistorySection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
