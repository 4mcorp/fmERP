# 의존성 규칙

기준: [TECH_SPEC 2·3·5장](../TECH_SPEC.md)
스킬: **`supply-chain-risk-auditor`**(의존성 위험 점검)

## 1. 버전
- 버전은 TECH_SPEC 2·3장에 고정되어 있다. 메이저·마이너 버전을 바꾸려면 사용자 승인을 받고 TECH_SPEC을 갱신한다.
- `package.json`에는 `~`(패치만 허용) 범위로 적는다. lockfile은 반드시 커밋한다.
- 같은 계열 패키지는 버전을 함께 맞춘다: `better-auth`·`@better-auth/*`, `@tanstack/*`, `@aws-sdk/*`, `@tiptap/*`, `@playwright/test`·Playwright Docker 이미지.

## 2. 새 패키지를 추가할 때
1. 정말 필요한지 먼저 판단한다. 표준 API나 이미 있는 패키지로 되면 추가하지 않는다.
2. 다음을 확인한다.
   - **최근 12개월 안에 배포**된 적이 있는지
   - **라이선스**: MIT·Apache-2.0·BSD·ISC는 허용. GPL·AGPL·Commons Clause·Elastic 등은 사전 승인 필요
   - **peer 의존성 범위**
3. `pnpm add <패키지>@~<버전>`으로 설치하고, peer 충돌이 0건인지 확인한다 (`strictPeerDependencies: true`).
4. TECH_SPEC 3장 표에 추가한다.

## 3. pnpm 11 설정
pnpm 설정(`strictPeerDependencies`, `allowBuilds` 등)은 `.npmrc`가 아니라 **`pnpm-workspace.yaml`** 에 둔다 ([ts: pnpm 11 설정 위치](../ts/2026-10-03-pnpm11-config-location.md)).
