"use client";

import { api, errorMessage } from "@fmerp/shared/lib/api";
import { ROLE_LABEL, type Role } from "@fmerp/shared/lib/types";
import { Button } from "@fmerp/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fmerp/shared/ui/card";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

/** 초대 수락 (AUTH-006). 링크로 수락하므로 이메일이 일치하지 않아도 된다 */
export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [accepting, setAccepting] = useState(false);
  const { data, error, isPending } = useQuery({
    queryKey: ["invitation", token],
    queryFn: () => api<{ accountName: string; role: Role }>(`/api/invitations/${token}`),
  });

  async function accept() {
    setAccepting(true);
    try {
      await api("/api/invitations/accept", { method: "POST", body: { token } });
      await queryClient.invalidateQueries();
      toast.success("합류했습니다");
      router.push("/");
    } catch (e) {
      toast.error(errorMessage(e));
      setAccepting(false);
    }
  }

  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <CardTitle>회사 초대</CardTitle>
        <CardDescription>
          {isPending && "초대를 확인하고 있습니다…"}
          {error && errorMessage(error)}
          {data && `${data.accountName}에 ${ROLE_LABEL[data.role]}(으)로 초대받았습니다.`}
        </CardDescription>
      </CardHeader>
      {data && (
        <CardContent>
          <Button onClick={accept} disabled={accepting} className="w-full">
            {accepting ? "합류하는 중…" : "초대 수락"}
          </Button>
        </CardContent>
      )}
    </Card>
  );
}
