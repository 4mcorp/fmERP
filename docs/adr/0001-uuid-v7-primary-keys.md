---
status: accepted
---

# 기본 키는 PostgreSQL 18 내장 uuidv7()

모든 테이블의 기본 키는 `uuid` 타입에 기본값 `uuidv7()`를 쓴다. UUID v7은 시간순으로 정렬되어 B-tree 인덱스 삽입 효율이 bigint에 가깝고, ID로 레코드 수나 다른 계정의 ID를 추측할 수 없으며, 로컬 서버 → 다른 서버 이관이나 계정 데이터 병합 때 키 충돌이 없다. PostgreSQL 18부터 확장 없이 `uuidv7()`를 제공한다.

**Considered Options:** bigint identity(가장 작고 빠르지만 추측 가능하고 이관·병합 시 충돌), UUID v4(무작위라 인덱스 단편화).
