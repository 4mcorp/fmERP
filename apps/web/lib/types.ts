// /api 응답 타입 (apps/web/server/routes의 스키마와 같게 유지한다)

export type Role = "owner" | "admin" | "member";
export type MemberStatus = "active" | "leave" | "left";

export interface MyAccount {
  accountId: string;
  name: string;
  role: Role;
  status: MemberStatus;
}

export interface Me {
  id: string;
  name: string;
  email: string;
  hasSignature: boolean;
  hasStamp: boolean;
  hasPin: boolean;
  activeAccountId: string | null;
  accounts: MyAccount[];
  devTestLogin: boolean;
}

export interface CurrentAccount {
  id: string;
  name: string;
  myRole: Role;
}

export interface Member {
  userId: string;
  name: string;
  email: string;
  role: Role;
  status: MemberStatus;
  joinedAt: string;
}

export interface Invitation {
  id: string;
  role: Role;
  email: string | null;
  status: "pending" | "used" | "expired" | "revoked";
  expiresAt: string;
  createdAt: string;
}

export interface SessionInfo {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  lastActiveAt: string;
  current: boolean;
}

export interface LoginHistoryItem {
  occurredAt: string;
  action: string;
  result: "success" | "failure";
  ip: string | null;
  userAgent: string | null;
  reason: string | null;
}

export interface DevTestUser {
  email: string;
  name: string;
  purpose: string;
  memberships: { account: string; role: Role }[];
}

export const ROLE_LABEL: Record<Role, string> = {
  owner: "소유자",
  admin: "관리자",
  member: "구성원",
};

export const STATUS_LABEL: Record<MemberStatus, string> = {
  active: "재직",
  leave: "휴직",
  left: "비활성",
};

const dateTime = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Seoul",
});

/** 날짜·시간은 Asia/Seoul로 표시한다 (PRD NFR-U05) */
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
