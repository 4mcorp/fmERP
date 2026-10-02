---
status: accepted
---

# 금액은 원 단위 정수: DB bigint, 앱 number

금액은 원화 정수만 다루므로 DB 컬럼은 `bigint`(원), 앱 내부는 `number`로 표현하고 `@fmerp/core`의 `toWon()`으로 안전한 정수 범위(약 9천조 원)를 검증한다. Drizzle에서는 `bigint({ mode: "number" })`로 매핑한다. 부동소수점 계산은 금지한다.

**Considered Options:** `numeric`(소수 통화용이라 과함, 문자열로 다뤄야 함), JS `BigInt`(JSON 직렬화·폼 처리 비용이 큼). 외화(PRD 2차)를 도입하면 이 결정을 다시 검토한다.
