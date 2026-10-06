// 개발·테스트용 시드 계정 (M1 계획 1장). 개발 DB에만 들어가며, 운영에서는 테스트 로그인이 꺼진다.
// 비밀번호는 이 파일에만 기록한다. 실제 서비스 비밀번호로 쓰지 않는다.

export const DEV_TEST_PASSWORD = "fmerp-dev-only-1234";

export const TEST_ACCOUNTS = {
  main: { slug: "fourm-test", name: "포엠테스트(주)" },
  other: { slug: "other-company", name: "다른회사(주)" },
} as const;

type TestAccountKey = keyof typeof TEST_ACCOUNTS;

export interface TestUser {
  email: string;
  name: string;
  /** 소속 계정과 역할·상태 */
  memberships: { account: TestAccountKey; role: "owner" | "admin" | "member"; status?: "left" }[];
  /** /dev-login 화면에 보이는 용도 설명 */
  purpose: string;
}

export const TEST_USERS: TestUser[] = [
  {
    email: "owner@example.com",
    name: "김대표",
    memberships: [{ account: "main", role: "owner" }],
    purpose: "소유자",
  },
  {
    email: "admin@example.com",
    name: "이관리",
    memberships: [{ account: "main", role: "admin" }],
    purpose: "관리자 (초대·구성원 관리)",
  },
  {
    email: "member1@example.com",
    name: "박사원",
    memberships: [{ account: "main", role: "member" }],
    purpose: "일반 구성원",
  },
  {
    email: "member2@example.com",
    name: "최대리",
    memberships: [{ account: "main", role: "member" }],
    purpose: "일반 구성원",
  },
  {
    email: "owner-b@example.com",
    name: "정대표",
    memberships: [{ account: "other", role: "owner" }],
    purpose: "다른 회사 소유자 (테넌트 격리 확인)",
  },
  {
    email: "multi@example.com",
    name: "한겸직",
    memberships: [
      { account: "main", role: "member" },
      { account: "other", role: "member" },
    ],
    purpose: "두 회사 소속 (계정 전환)",
  },
  {
    email: "left@example.com",
    name: "윤퇴사",
    memberships: [{ account: "main", role: "member", status: "left" }],
    purpose: "비활성(퇴사) 구성원 (진입 차단 확인)",
  },
  {
    email: "bizadmin@example.com",
    name: "오사업",
    memberships: [{ account: "main", role: "member" }],
    purpose: "사업자 관리자 (포엠테스트 본사 범위)",
  },
  {
    email: "hr@example.com",
    name: "송인사",
    memberships: [{ account: "main", role: "member" }],
    purpose: "인사 관리자 (계정 범위)",
  },
  {
    email: "auditor@example.com",
    name: "감사인",
    memberships: [{ account: "main", role: "member" }],
    purpose: "감사인 (경영지원본부 범위)",
  },
  {
    email: "approver@example.com",
    name: "결재관리",
    memberships: [{ account: "main", role: "member" }],
    purpose: "결재 관리자 (계정 범위)",
  },
  {
    email: "newbie@example.com",
    name: "신입사원",
    memberships: [],
    purpose: "소속 없음 (회사 만들기·초대 수락)",
  },
  {
    email: "newbie2@example.com",
    name: "신입둘",
    memberships: [],
    purpose: "소속 없음 (초대에 지정한 소속으로 합류하는 흐름 확인)",
  },
];
