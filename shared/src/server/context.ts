import type { AuditRequestContext } from "@fmerp/audit";
import type { Tx } from "@fmerp/db";
import type { ObjectStorage } from "@fmerp/storage";

/** 결재 서비스 호출 문맥. tx는 호출자가 연 withTenant 트랜잭션이다 */
export interface ServiceContext {
  tx: Tx;
  storage: ObjectStorage;
  accountId: string;
  now: Date;
  userId: string | null;
  request: AuditRequestContext;
}
