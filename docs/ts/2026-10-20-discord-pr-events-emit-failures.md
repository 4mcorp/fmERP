---
title: discord-pr-events emit 간헐 실패 — 로그 보강·직렬화·알림 격리
date: 2026-10-20
status: open
tags: [ci, discord, workflow, concurrency, notifier, flaky]
related: [.github/workflows/discord-pr-events.yml, .github/scripts/discord_pr_event.py, .github/scripts/test_discord_pr_event.py]
---

## 증상

- `discord-pr-events` 최근 200 run 중 failure 18 / success 182 (2026-10-20 리뷰어 집계).
- 실패는 2026-10-19 17:37 ~ 2026-10-20 09:54에 몰렸고, 같은 분에 2~4건이 겹쳤다.
- 실패 run은 `emit` 잡의 단일 스텝이 9~12초 만에 실패했다. 로그는 `notifier failed: event validation or delivery; no verified receipt` 한 줄뿐이었다.

## 원인 (미확정)

원인은 아직 확정하지 않았다. 후보는 세 가지다.

- (a) 429 재시도 예산(최대 3회 대기, 대기 한 번당 30초 이하) 초과.
- (b) `?wait=true` 전송 후 readback GET 단계 오류.
- (c) 이벤트 검증 거부. 근거가 약하다.

기존 로그는 단계를 구분하지 못했다. 그래서 어느 후보인지 판정할 수 없었다. 보강된 로그가 실패 run에서 나온 뒤 이 항목을 갱신한다.

## 조치 (2026-10-20 구현)

1. **로그 보강.** 실패 한 줄에 `stage`(validate/post/readback), HTTP 상태 코드, 예외 클래스명, 429일 때 `retry_after` 값만 출력한다. 웹훅 URL, 본문, 메시지 content, 예외 메시지 원문은 출력하지 않는다. `test_discord_pr_event.py`가 토큰과 페이로드가 로그에 없음을 검사한다.
2. **직렬화.** workflow에 `concurrency: {group: discord-pr-events, cancel-in-progress: false, queue: max}`를 두었다.
   - `cancel-in-progress: false`만으로는 무손실이 아니다. 기본 `queue: single`은 대기 중인 실행을 새 실행이 **교체**한다(GitHub Docs, Control workflow concurrency). 그래서 `queue: max`를 함께 쓴다.
   - `queue: max`는 `cancel-in-progress: true`와 함께 쓸 수 없다. 이 workflow는 `false`라 충돌하지 않는다.
   - 대기열은 최대 100건이다. 101번째부터는 GitHub가 취소한다. 버스트가 그보다 크면 여전히 유실될 수 있다. 이 한계는 남은 위험이다.
   - 지터 백오프는 넣지 않았다. (a)가 확정된 뒤 결정한다.
3. **알림 격리.** 세 스텝(resolve·checkout·send)에 `continue-on-error: true`를 주고, 뒤 스텝은 앞 스텝 `outcome == 'success'`일 때만 돈다. 마지막 요약 스텝은 `if: always()`로 단계별 결과를 `GITHUB_STEP_SUMMARY`와 `::warning::`에 남긴다. PR 체크 실패로 번지지 않는다. `check`·`policy` 목록은 바꾸지 않았다.
4. **웹훅 시크릿.** `HERMES_DISCORD_EVENTS_WEBHOOK`은 send 스텝에만 전달한다. 다른 스텝에는 노출하지 않는다. 시크릿 값은 바꾸지 않았다.

## 재발 방지 규칙

- 알림 실패는 로그 한 줄로 끝내지 말고 **단계명과 상태 코드**를 남긴다. 예외 메시지 원문은 비밀값을 담을 수 있으므로 출력하지 않고 클래스명만 남긴다.
- `cancel-in-progress: false`만 설정하고 무손실을 가정하지 않는다. 대기 실행을 보존하려면 `queue: max`가 필요하다.
- 알림 workflow는 PR 체크와 분리한다. 알림 실패가 `pull_request_target` 체크를 빨갛게 만들면 안 된다.

## 설계만 기록: 영구 실패 1회 경보 (중복 억제)

구현하지 않는다. 근거가 생긴 뒤 별도 카드로 다룬다.

- 조건: 같은 `stage`와 `status`(또는 `exc`) 조합이 N분 안에 M회 이상 나오면 경보 1건을 보낸다.
- 저장: 중복 억제 상태를 Discord나 repo에 두지 않는다. 필요하면 GitHub Actions 캐시나 workflow 출력의 요약으로 충분한지 먼저 본다. 웹훅 URL과 토큰은 상태에 넣지 않는다.
- 경보 본문: 단계, 상태 코드, 발생 횟수, run URL만 담는다. 원문은 담지 않는다.
- 재발송 조건: 직전 경보 후 상태가 바뀌었거나 일정 시간이 지났을 때만 다시 보낸다.

## 확인 상태

- 단위 시험: `python3 -m unittest discover -s .github/scripts -p 'test_*.py'` 통과(47건, skipped 1건).
- 실제 failure run에서 보강 로그가 나온 뒤 원인을 확정해야 한다. 그 전까지는 "미확정"이다.
- actionlint는 로컬에 없어 실행하지 않았다. `queue` 키의 문법은 GitHub에서 CI 실행으로 확인한다.
