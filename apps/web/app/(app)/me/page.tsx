"use client";

import { PinSection } from "@/components/me/pin-section";
import { ProfileSection } from "@/components/me/profile-section";
import { LoginHistorySection, SessionsSection } from "@/components/me/sessions-section";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMe } from "@/lib/queries";

export default function MePage() {
  const { data: me } = useMe();
  if (!me) return null;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">내 정보</h1>
      <Tabs defaultValue="profile">
        <TabsList className="flex-wrap">
          <TabsTrigger value="profile">프로필</TabsTrigger>
          <TabsTrigger value="pin">결재 PIN</TabsTrigger>
          <TabsTrigger value="sessions">세션</TabsTrigger>
          <TabsTrigger value="history">로그인 이력</TabsTrigger>
        </TabsList>
        <TabsContent value="profile">
          <ProfileSection me={me} />
        </TabsContent>
        <TabsContent value="pin">
          <PinSection hasPin={me.hasPin} />
        </TabsContent>
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
