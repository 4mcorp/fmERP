---
title: S3 서명 URL 업로드가 BadDigest(400)로 거부됨 (AWS SDK 기본 체크섬)
date: 2026-10-03
status: resolved
tags: [storage, s3, aws-sdk, upload]
related: [packages/storage/src/object-storage.ts, docs/rules/storage-backup.md, FILE-004]
---

## 증상
`presignPut()`으로 만든 URL에 브라우저(fetch)로 PUT하면 400이 난다.
```
<Code>BadDigest</Code><Message>The Content-Md5 you specified did not match what we received.</Message>
```
서명 URL 쿼리에 `x-amz-checksum-crc32=AAAAAA==&x-amz-sdk-checksum-algorithm=CRC32`가 들어 있다.

## 원인
AWS SDK v3의 기본값 `requestChecksumCalculation: "WHEN_SUPPORTED"`는 서명 시점의 **빈 본문**으로 CRC32를 계산해 URL에 넣는다. 실제 업로드 본문과 체크섬이 달라 저장소가 거부한다. SeaweedFS뿐 아니라 R2 등 S3 호환 저장소에서도 같은 문제가 생긴다.

## 해결
`S3Client`에 `requestChecksumCalculation: "WHEN_REQUIRED"`와 `responseChecksumValidation: "WHEN_REQUIRED"`를 설정했다. 통합 테스트 "서명 URL로 업로드하고 내려받을 수 있다"가 통과한다.

## 재발 방지 규칙
- S3 클라이언트는 `packages/storage`에서만 만들고, 위 두 체크섬 옵션을 유지한다.
- 서명 URL 기능은 통합 테스트로 **실제 fetch 업로드·다운로드**까지 검증한다. URL 생성만 확인하지 않는다.

## 재발 기록
