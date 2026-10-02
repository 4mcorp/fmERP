---
title: pnpm 11에서 .npmrc의 strict-peer-dependencies 설정이 적용되지 않음
date: 2026-10-03
status: resolved
tags: [pnpm, deps, config]
related: [docs/rules/dependencies.md, docs/TECH_SPEC.md]
---

## 증상
peer 의존성 검증을 위해 `.npmrc`에 `strict-peer-dependencies=true`를 두고 `pnpm install`을 실행했다. 설치는 성공했지만 설정이 실제로 적용됐는지 보장되지 않았다. 함께 실행한 npm은 `Unknown project config "strict-peer-dependencies"` 경고를 냈다.

## 원인
pnpm 11은 프로젝트 설정을 `pnpm-workspace.yaml`에서 읽는다. `.npmrc`는 레지스트리·인증 용도로만 남았다.

## 해결
`pnpm-workspace.yaml`에 다음을 두고 처음부터 다시 설치했다. `pnpm config get strictPeerDependencies`가 `true`를 반환하고, 설치가 peer 충돌 0건으로 성공하는 것을 확인했다.
```yaml
strictPeerDependencies: true
autoInstallPeers: false
allowBuilds:
  esbuild: true
```

## 재발 방지 규칙
- pnpm 설정은 `pnpm-workspace.yaml`에 둔다. `.npmrc`에는 레지스트리·인증 정보만 둔다.
- 설정을 바꾼 뒤에는 `pnpm config get <키>`로 실제 적용 값을 확인한다.
- pnpm 11은 빌드 스크립트를 기본 차단한다(`ERR_PNPM_IGNORED_BUILDS`). 필요한 패키지만 `allowBuilds`에 추가한다.

## 재발 기록
