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

export type GrantRole = "business_admin" | "approval_admin" | "auditor" | "hr_admin";
export type ScopeType = "account" | "business" | "department";

export interface MemberAssignment {
  id: string;
  businessId: string;
  businessName: string;
  departmentId: string;
  departmentName: string;
  positionId: string | null;
  positionName: string | null;
  dutyId: string | null;
  dutyName: string | null;
  isPrimary: boolean;
}

export interface MemberGrant {
  id: string;
  role: GrantRole;
  scopeType: ScopeType;
  scopeId: string | null;
  scopeLabel: string;
}

export interface Member {
  userId: string;
  membershipId: string;
  name: string;
  email: string;
  role: Role;
  status: MemberStatus;
  employeeNo: string | null;
  joinedAt: string;
  assignments: MemberAssignment[];
  grants: MemberGrant[];
}

export interface Business {
  id: string;
  name: string;
  bizRegNo: string;
  corpRegNo: string | null;
  ceoName: string | null;
  industry: string | null;
  address: string | null;
  phone: string | null;
  code: string;
  hasSeal: boolean;
  active: boolean;
}

export interface Department {
  id: string;
  businessId: string;
  parentId: string | null;
  depth: number;
  code: string;
  name: string;
  shortName: string | null;
  headMembershipId: string | null;
  headName: string | null;
  sort: number;
  active: boolean;
  validFrom: string | null;
  validTo: string | null;
  memberCount: number;
}

export interface OrgChart {
  maxDeptDepth: number;
  businesses: { id: string; name: string; active: boolean; departments: Department[] }[];
}

export interface MasterItem {
  id: string;
  name: string;
  rank?: number;
  active: boolean;
}

export interface AccountSettings {
  id: string;
  name: string;
  allowedDomains: string[];
  maxDeptDepth: number;
  timezone: string;
  locale: string;
  securityPolicy: {
    idleTimeoutMinutes?: number;
    absoluteTimeoutHours?: number;
    pinRequired?: boolean;
    attachmentMaxMb?: number;
    attachmentExtensions?: string[];
  };
}

export type Capabilities = Record<string, boolean>;

export interface AssignmentHistoryItem {
  id: string;
  action: string;
  changes: Record<string, unknown>;
  effectiveDate: string;
  reason: string | null;
  actorName: string | null;
}

export interface Invitation {
  id: string;
  role: Role;
  email: string | null;
  preset: { businessId?: string; departmentId?: string; positionId?: string | null };
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

export const GRANT_ROLE_LABEL: Record<GrantRole, string> = {
  business_admin: "사업자 관리자",
  approval_admin: "결재 관리자",
  auditor: "감사인",
  hr_admin: "인사 관리자",
};

/** 역할별로 부여할 수 있는 범위 (packages/core permissions.ts와 같게 유지한다) */
export const GRANT_ROLE_SCOPES: Record<GrantRole, ScopeType[]> = {
  business_admin: ["business"],
  approval_admin: ["account", "business"],
  auditor: ["account", "business", "department"],
  hr_admin: ["account", "business"],
};

export const SCOPE_LABEL: Record<ScopeType, string> = {
  account: "계정 전체",
  business: "사업자",
  department: "부서(하위 포함)",
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
