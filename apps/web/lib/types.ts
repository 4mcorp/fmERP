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

// ===== 전자결재 (M4) =====
import type { FormSchema } from "@fmerp/core";

export type StepType = "approve" | "agree" | "cooperate" | "audit" | "post";
export type SecurityLevel = "normal" | "confidential" | "secret";

export type LineTarget =
  | { kind: "user"; membershipId: string }
  | { kind: "department"; departmentId: string; mode: "head" | "any" }
  | { kind: "drafter_head"; levels?: number }
  | { kind: "duty"; dutyName: string }
  | { kind: "business_ceo"; businessId: string; positionName?: string };

export interface LineItemInput {
  type: StepType;
  seq: number;
  target: LineTarget;
  quorum?: "all" | number;
}

export interface FormSummary {
  id: string;
  code: string;
  name: string;
  category: string;
  active: boolean;
  scope: { businessIds?: string[]; departmentIds?: string[] };
  version: number;
  versionId: string;
  retentionYears: number;
  allowLineEdit: boolean;
  favorite: boolean;
  lastUsedAt: string | null;
}

export interface FormDefinition {
  schema: FormSchema;
  layout?: Record<string, unknown>;
  defaultLine: LineItemInput[];
  numbering: { rule: string; cycle: "year" | "month" | "none"; at: "submit" | "complete" } | null;
  retentionYears: 0 | 1 | 3 | 5 | 10;
  securityDefault: SecurityLevel;
  recipients?: Record<string, unknown>;
  allowLineEdit: boolean;
  policy: {
    disagree: "reject" | "comment";
    rejectTo: "drafter" | "previous";
    auditCanReject: boolean;
  };
}

export interface FormDetail {
  id: string;
  code: string;
  name: string;
  category: string;
  active: boolean;
  scope: { businessIds?: string[]; departmentIds?: string[] };
  version: number;
  versionId: string;
  definition: FormDefinition;
}

export interface StepAssignee {
  membershipId?: string;
  name?: string;
  departmentName?: string | null;
  positionName?: string | null;
  dutyName?: string | null;
}

export interface ApprovalStepView {
  id: string;
  seq: number;
  type: StepType;
  status: string;
  version: number;
  canFinalize: boolean;
  assignees: StepAssignee[];
}

export interface ApprovalView {
  id: string;
  title: string;
  status: string;
  docNo: string | null;
  businessId: string;
  drafterMembershipId: string;
  drafterSnapshot: StepAssignee;
  formVersionId: string | null;
  securityLevel: SecurityLevel;
  urgent: boolean;
  desiredDueDate: string | null;
  latestRevision: number;
  supersedes: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  steps: ApprovalStepView[];
}

export interface AttachmentInfo {
  id: string;
  filename: string;
  size: number;
  mime: string;
  sha256: string;
}

export interface CommentInfo {
  id: string;
  stepId: string | null;
  authorName: string;
  body: string;
  visibility: "all" | "drafter";
  createdAt: string;
}

export interface PendingItem {
  documentId: string;
  title: string;
  status: string;
  urgent: boolean;
  securityLevel: SecurityLevel;
  docNo: string | null;
  submittedAt: string | null;
  drafterSnapshot: StepAssignee;
  stepId: string;
  stepType: StepType;
  stepStatus: string;
  stepVersion: number;
  asDelegate: boolean;
}

export interface MineItem {
  id: string;
  title: string;
  status: string;
  docNo: string | null;
  urgent: boolean;
  formCategory: string | null;
  supersedes: string | null;
  submittedAt: string | null;
  updatedAt: string;
}

export const STEP_TYPE_LABEL: Record<StepType, string> = {
  approve: "결재",
  agree: "합의",
  cooperate: "협조",
  audit: "감사",
  post: "후결",
};

export const DOC_STATUS_LABEL: Record<string, string> = {
  DRAFT: "임시저장",
  IN_PROGRESS: "진행 중",
  ON_HOLD: "보류",
  WITHDRAWN: "회수",
  REJECTED: "반려",
  COMPLETED: "완료",
  CANCELED: "취소",
  ARCHIVED: "보관",
};

export const STEP_STATUS_LABEL: Record<string, string> = {
  PENDING: "대기",
  ACTIVE: "결재 차례",
  APPROVED: "승인",
  REJECTED: "반려",
  HELD: "보류",
  SKIPPED: "건너뜀",
  DELEGATED: "대결 처리",
  POST_PENDING: "후결 대기",
  POST_APPROVED: "후결 완료",
};

export const SECURITY_LABEL: Record<SecurityLevel, string> = {
  normal: "일반",
  confidential: "대외비",
  secret: "비밀",
};
