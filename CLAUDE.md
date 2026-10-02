# 4mERP

전자결재 중심 ERP (사용자 100명 이하, 서울 VPS 1대 + 외부 S3). 사용자와 문서는 한국어로 소통한다.

## 기준 문서 (작업 전 해당 부분만 읽기)
- 요구사항: `docs/PRD.md` — 요구사항 ID(APV-030 등)로 참조
- 기술 스택·버전·구조: `docs/TECH_SPEC.md`
- 배포·백업: `docs/DEPLOYMENT_PLAN.md`
- 도메인 용어: `GLOSSARY.md`, 설계 결정: `docs/adr/`

## 스택 (버전 변경 금지 — 바꾸려면 TECH_SPEC 갱신 + 사용자 승인)
Node 24 LTS · pnpm 11 · TypeScript ~6.0 · Next 16.3 + Hono 4.13(`/api`) · PostgreSQL 18 · Drizzle 0.45 · Better Auth 1.7 · Zod 4 · pg-boss 12 · Tailwind 4 + shadcn(Radix) · Vitest 4.1 · Playwright 1.63 · Biome 2.5
- 패키지 추가 시 `~` 범위로 고정하고 `pnpm install`에서 peer 충돌이 없어야 한다 (strictPeerDependencies).
- 라이브러리 API는 학습 데이터보다 최신일 수 있다. 확신이 없으면 공식 문서를 확인한다.

## 구조 규칙
- `packages/core`(결재 엔진·도메인)는 프레임워크·DB를 import하지 않는다.
- 모든 테이블에 `account_id` + RLS. 테넌트 경계를 넘는 쿼리 금지.
- 감사 로그(`audit_log`)는 INSERT만 한다. UPDATE·DELETE 코드 금지.
- 완료 문서 패키지(S3 `final/`)는 한 번만 쓴다. 덮어쓰기 금지.
- 문서 본문·첨부는 S3, DB에는 색인·상태·S3 키만 둔다.

## 작업 원칙
1. **먼저 생각한다:** 요구사항이 모호하면 가정하지 말고 질문한다. 해석이 여러 개면 제시한다.
2. **단순하게:** 요청된 것만 만든다. 추측성 추상화·옵션·설정을 추가하지 않는다.
3. **필요한 부분만 수정:** 관련 없는 코드·주석·포맷은 건드리지 않는다.
4. **검증으로 끝낸다:** 완료 기준(테스트 통과, 타입 검사, 화면 확인)을 정하고 확인한 뒤 완료라고 말한다.
- 결재 엔진 등 규칙이 복잡한 로직은 `tdd` 스킬로 테스트부터 작성한다.
- 여러 파일을 훑는 조사는 서브에이전트(Explore)에 맡기고 결론만 받는다.

## 명령어 (프로젝트 골격 생성 후 갱신)
- 설치: `pnpm install` / 개발: `pnpm dev` / 테스트: `pnpm test` / 타입: `pnpm typecheck` / 린트: `pnpm lint`

## 스킬
`.claude/skills/`에 설치됨 (목록과 용도는 TECH_SPEC 6장). 스킬 추가·업데이트는 SKILL.md를 리뷰한 뒤 `skills-lock.json`과 함께 커밋한다.
