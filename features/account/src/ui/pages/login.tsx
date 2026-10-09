import { AuthLayout } from "../components/auth-layout";

/** 소셜 로그인(Google·Naver)은 M9에서 구현한다. 지금은 안내만 보여 준다. */
export default function LoginPage() {
  return (
    <AuthLayout
      title="4mERP 로그인"
      description="로그인 기능을 준비하고 있습니다. 개발 환경에서는 테스트 로그인을 사용하세요."
    />
  );
}
