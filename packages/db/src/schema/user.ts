// 사용자 (Better Auth user 모델, ADR 0005). 테넌트·세션·조직 표가 모두 참조하므로 순환을 피하려고 따로 둔다.
import { boolean, pgTable, text } from "drizzle-orm/pg-core";
import { createdAt, primaryId, updatedAt } from "./columns";

/** @owner shared */
export const user = pgTable("user", {
  id: primaryId(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean().notNull().default(false),
  image: text(),
  /** 서명·도장 이미지의 S3 키 (PRD AUTH-016) */
  signatureKey: text(),
  stampKey: text(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
