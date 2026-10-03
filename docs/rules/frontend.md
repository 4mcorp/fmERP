# 프런트엔드 규칙

기준: [PRD 8장 화면 구성 · 6.5 사용성](../PRD.md) · [TECH_SPEC 1장 D1·D2](../TECH_SPEC.md)
스킬: **`shadcn`**, **`vercel-react-best-practices`**, **`web-design-guidelines`**(UI 점검)

## 0. Next.js 16 문서
Next 16은 학습 데이터와 API가 다를 수 있다. 코드를 쓰기 전에 `apps/web/AGENTS.md`의 안내대로 `apps/web/node_modules/next/dist/docs/`의 해당 문서를 읽거나 Context7로 확인한다. (`AGENTS.md`·`CLAUDE.md`는 `next dev`가 자동 생성하는 파일이므로 지우지 않는다.)

## 1. 컴포넌트
- UI는 shadcn/ui(Radix 기반) + Tailwind 4로 만든다. 컴포넌트는 shadcn MCP·CLI로 `apps/web/components/ui/`에 추가한다.
- 생성된 기본 컴포넌트를 크게 고치지 말고, 감싸는 컴포넌트를 따로 만든다.
- 데이터 목록(문서함, 감사 로그, 구성원 등)은 tablecn(TanStack Table 9) 기반 데이터 그리드를 쓴다.
- 아이콘은 lucide-react, 알림 토스트는 shadcn 기본 방식을 쓴다.

## 2. 데이터와 폼
- 서버 상태는 TanStack Query로 관리한다. 같은 데이터를 컴포넌트 상태에 복사해 두지 않는다.
- 폼은 react-hook-form + Zod resolver를 쓰고, **API와 같은 Zod 스키마**를 쓴다.
- 기안 작성 중인 내용은 Dexie(IndexedDB)에 자동 저장한다 (PRD BAK-001).

## 3. 표시 규칙
- UI 문구는 한국어로 쓴다. 날짜·시간은 Asia/Seoul로 표시한다. 금액은 원 단위 천 단위 구분으로 표시한다.
- 360px 모바일 화면에서 **결재 처리 전 과정**(본문 확인, 첨부 확인, 승인·반려, 의견)이 가능해야 한다 (PRD APV-048, NFR-U02).
- 접근성은 KWCAG 2.2(WCAG 2.1 AA 수준)를 지킨다. 화면을 완성하면 `web-design-guidelines`로 점검한다 (PRD NFR-U03).

## 4. 확인
화면 작업을 마치면 `playwright-cli` 스킬로 실제 화면을 열어 확인한다. 타입 검사만으로 완료 처리하지 않는다.
