# Claude 부가 도구 비교 (토큰 절감 · 출력 품질) — 검토용

| 항목 | 내용 |
|---|---|
| 작성일 | 2026-10-03 |
| 상태 | **검토 요청** |
| 조사 방법 | GitHub 스타 수(API), npm 라이선스, Anthropic 공식 플러그인 마켓 목록, 독립 벤치마크(JetBrains 등) |

---

## 0. 결론 요약

> 1. **먼저 Claude Code 내장 기능을 제대로 쓰는 것이 효과가 가장 크고 비용이 없습니다.** CLAUDE.md를 짧게 유지하고, hooks로 자동 검사를 걸고, 서브에이전트로 탐색하는 것이 핵심입니다.
> 2. 외부 도구 중 **효과가 검증된 것은 품질 쪽**입니다. 버전에 맞는 최신 문서를 주는 **Context7**, 코드를 정확히 탐색하게 하는 **공식 `typescript-lsp` 플러그인**이 여기에 해당합니다.
> 3. **"토큰 60~90% 절감"을 내세우는 도구는 독립 벤치마크에서 대부분 효과가 미미하거나 오히려 비용이 늘었습니다.** caveman은 −8.5%, rtk는 저노력 모드에서 +7.6%였습니다.
> 4. 워크플로 프레임워크(superpowers, spec-kit, BMAD 등)는 이미 설치한 mattpocock 스킬과 우리 문서 체계와 **역할이 겹쳐 충돌**하므로 쓰지 않습니다.
> 5. 원칙: **ccusage로 2주 동안 기준선을 측정한 뒤, 도구를 하나씩 넣고 같은 작업으로 비교**합니다. 도구가 스스로 보고하는 절감량이 아니라 실제 청구 금액을 봅니다.

---

## 1. 내장 기능 (설치 불필요 · 최우선)

| 기능 | 효과 | 적용 방법 | 제안 |
|---|---|---|---|
| **CLAUDE.md** | 매 턴 컨텍스트에 들어가므로, 짧고 정확할수록 토큰이 줄고 품질이 오름 | 100줄 이내. 스택·명령어·금지사항·문서 위치만 적고, 세부 내용은 docs 링크로 대체 | ✅ 적용 (작성 완료) |
| **스킬 점진적 로딩** | 설치한 스킬은 설명만 상주하고 본문은 필요할 때만 로드됨 | 이미 적용 (19개 설치) | ✅ |
| **서브에이전트 (Explore 등)** | 넓은 탐색은 별도 컨텍스트에서 하고 결론만 받아 메인 컨텍스트를 아낌 | "여러 파일을 훑는 조사"는 서브에이전트에 맡기도록 CLAUDE.md에 명시 | ✅ |
| **Hooks** | 편집 직후 포맷, 작업 종료 전 타입 검사를 자동 실행해 오류를 즉시 되먹임 → 재작업 감소 | PostToolUse(Edit·Write) → `biome check --write <파일>`, Stop → `tsc --noEmit` + 변경 관련 `vitest related` | ✅ 프로젝트 골격을 만든 뒤 적용 |
| **권한 허용 목록** | 읽기 전용 명령 승인 대기가 줄어듦 | `/fewer-permission-prompts` 스킬로 자주 쓰는 명령을 허용 목록에 추가 | ✅ 개발 시작 후 |
| **/compact · /clear · 계획 모드** | 긴 세션의 컨텍스트 누적 방지, 큰 작업은 계획 후 실행 | 기능 단위로 세션을 나누고, 끝나면 `/clear` | ✅ 운영 습관 |
| **프롬프트 캐시** | 반복되는 컨텍스트는 1/10 가격으로 과금 (자동) | CLAUDE.md·스킬을 자주 바꾸지 않으면 캐시 적중률이 올라감 | ✅ 자동 |

---

## 2. 출력 품질 향상 도구

| 도구 | 지표 | 라이선스 | 효과 | 비용·위험 | 제안 |
|---|---|---|---|---|---|
| **Context7 MCP** (Upstash) | ★62.6k, **공식 마켓 등록** | MIT | 라이브러리의 **버전별 최신 문서**를 가져옴. 우리 스택(Next 16.3, Better Auth 1.7, Zod 4, Tailwind 4.3, Drizzle 0.45)은 모델 학습 이후 API가 바뀐 부분이 많아 효과가 큼 | 조회할 때마다 문서 조각이 입력 토큰에 추가됨. 무료 사용량 한도 있음(API 키 권장). 조회 질의가 Upstash 서버로 전송됨 | ✅ **권장** |
| **typescript-lsp 플러그인** (Anthropic 공식) | 공식 마켓 | – | 정의로 이동, 참조 찾기, 타입 오류를 언어 서버로 정확하게 확인 → grep 기반 추측 탐색을 줄임 | 언어 서버 프로세스가 추가로 실행됨 | ✅ **권장** (코드 작성 시작 시) |
| **andrej-karpathy-skills** (CLAUDE.md 1개) | ★216.6k | – | "코딩 전에 생각하기, 단순하게, 필요한 부분만 수정, 목표 기반 검증" 4원칙으로 과잉 구현을 줄임 | 별도 설치 없이 **원칙만 우리 CLAUDE.md에 반영**하면 됨 | ✅ **반영 완료** |
| **hookify** (Anthropic 공식) | 공식 마켓 | – | 대화에서 반복되는 실수를 분석해 차단 hook을 만들어 줌 | 개발이 진행되며 반복 실수가 보일 때 유용 | ⏸ 개발 중 필요 시 |
| **security-guidance** (Anthropic 공식) | 공식 마켓 | – | 편집 시점에 보안 패턴 경고 | trailofbits 스킬과 일부 겹침 | ⏸ 보류 |
| **Playwright MCP** (공식 마켓) | 공식 마켓 | Apache-2.0 | 브라우저 조작 | 접근성 트리 전체를 컨텍스트에 넣어 토큰 소모가 큼. 이미 쓰는 playwright-cli가 결과를 파일로 저장해 더 효율적 | ❌ 비권장 (playwright-cli와 중복) |

---

## 3. 토큰 절감 도구

| 도구 | 지표 | 라이선스 | 대상 | 독립 측정 결과 | 제안 |
|---|---|---|---|---|---|
| **ccusage** | ★18.8k | MIT | 사용량 측정 (절감 도구가 아님) | 컨텍스트에 영향 없는 CLI. 일·세션·모델별 비용 집계 | ✅ **권장** — 측정이 먼저 |
| **Serena MCP** | ★29.9k, 공식 마켓 | MIT | 입력 (코드 읽기) | 코드 읽기 입력 −66% 사례가 있음. 단, 도구 정의 자체의 오버헤드가 있어 **작은 저장소에서는 손해** | ⏸ 코드가 5만 줄을 넘으면 재검토. 그 전에는 typescript-lsp로 충분 |
| **context-mode** | ★25k | Elastic-2.0 | 입력 (대형 출력) | Playwright·로그처럼 큰 출력을 별도 저장소에 두어 20~98% 절감 | ⏸ playwright-cli가 이미 파일로 저장해서 효과가 겹침. 로그 분석이 많아지면 재검토 |
| **caveman** | ★109k | – | 출력 (문장 축약) | 홍보 −65%, **JetBrains 측정 −8.5%**, 일반 사용 30~50%. 출력 토큰에만 효과 | ❌ 비권장. 축약 문체가 한국어 설명·문서 품질을 떨어뜨림 |
| **rtk** | ★82.2k | – | 입력 (셸 출력 필터) | **JetBrains 벤치마크(86개 작업, 약 425회): 저노력에서 비용 +7.6%, 고노력에서 +0.1%, 절감 없음.** 내장 Read·Grep은 이 도구를 거치지 않음 | ❌ 비권장 |
| **claude-mem** | ★95.2k | Apache-2.0 | 세션 간 기억 | 모든 대화를 기록하고 다음 세션에 주입 → 오히려 입력이 늘 수 있음. 대화 전체가 로컬에 저장됨(민감 정보) | ❌ 비권장. CLAUDE.md, docs, 내장 메모리로 충분 |
| **claude-context** (Zilliz) | – | – | 입력 (벡터 검색) | 대형 모노레포에서 30~60% | ❌ 비권장 (유료 OpenAI + Zilliz 필요, 우리 규모에 과함) |

---

## 4. 워크플로 프레임워크 / 하네스

| 도구 | 지표 | 라이선스 | 성격 | 제안 |
|---|---|---|---|---|
| obra/superpowers | ★294k | – | 브레인스토밍 → 계획 → TDD → 리뷰를 강제하는 방법론 | ❌ mattpocock 스킬과 충돌 (이전 D3에서 결정) |
| everything-claude-code (ECC) | ★271k | MIT | 스킬·에이전트·훅·메모리를 한꺼번에 담은 거대 묶음 | ❌ 너무 무겁고, 설치한 스킬과 중복·충돌 |
| github/spec-kit | ★140k | MIT | 명세 주도 개발(SDD) 템플릿·명령 | ❌ 이미 PRD·TECH_SPEC 체계가 있어 이중 관리가 됨 |
| get-shit-done | ★64k | MIT | 메타 프롬프팅·명세 주도 워크플로 (마지막 업데이트 2026-05) | ❌ 중복 |
| BMAD-METHOD | ★53.7k | MIT | 애자일 역할별 에이전트(PM, 아키텍트 등) | ❌ 1인~소규모 개발에 과함 |
| SuperClaude | ★23.9k | MIT | 명령·페르소나 프레임워크 | ❌ 중복 |
| claude-task-master | ★28.1k | MIT + Commons Clause | 작업 관리 | ❌ 라이선스 제약, 업데이트 정체(2026-04) |
| feature-dev / code-review / pr-review-toolkit (Anthropic 공식) | 공식 마켓 | – | 기능 개발·리뷰용 전문 에이전트 묶음 | ⏸ 내장 `/code-review`로 우선 충분. PR이 많아지면 재검토 |

---

## 5. 제안 조합

| 시점 | 적용 |
|---|---|
| **지금** | CLAUDE.md(작성 완료, karpathy 원칙 반영), shadcn MCP(설정 완료), **ccusage**(필요할 때 `npx ccusage`) |
| **승인 시 바로** | **Context7** — 공식 플러그인 또는 `.mcp.json`에 추가 |
| **프로젝트 골격 생성 후** | **typescript-lsp 플러그인**, **hooks**(Biome 포맷, tsc·vitest 검사), 권한 허용 목록 |
| **조건부 재검토** | Serena(코드 5만 줄 이상), context-mode(로그 분석 증가), hookify(반복 실수 발생) |
| **사용 안 함** | caveman, rtk, claude-mem, claude-context, 워크플로 프레임워크 전부 |

**검증 방법:** 도입 전 2주 동안 ccusage로 기준선을 잡고, 도구를 **하나씩** 추가한 뒤 비슷한 작업에서 다음을 비교합니다.
- 세션당 비용
- 재작업 횟수
- 테스트 통과율

절감 효과가 측정되지 않으면 제거합니다.

---

## 6. 출처
- [JetBrains — rtk Claude Code Token Savings 벤치마크 (2026-07)](https://blog.jetbrains.com/ai/2026/07/rtk-claude-code-token-savings/)
- [TechTimes — JetBrains 벤치마크 보도](https://www.techtimes.com/articles/321223/20260721/rtk-raises-claude-code-costs-low-effort-jetbrains-benchmark-debunks-6090-claim.htm)
- [ComputingForGeeks — Reduce Claude Code Tokens: 10 Tested Tools](https://computingforgeeks.com/reduce-claude-code-token-usage-tools/)
- [token-saviour — 계층별 도구 벤치마크](https://github.com/vagkaratzas/token-saviour)
- [Firecrawl — 12 Ways to Cut Token Consumption](https://www.firecrawl.dev/blog/claude-code-token-efficiency)
- [Caveman 리뷰 (andrew.ooo)](https://andrew.ooo/posts/caveman-claude-code-skill-token-savings-review/)
- Anthropic 공식 플러그인 마켓: `anthropics/claude-plugins-official` marketplace.json (315개 플러그인)
- GitHub 스타 수·라이선스: GitHub API, npm 레지스트리 (2026-10-03)
