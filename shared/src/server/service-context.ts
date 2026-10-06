import type { Tx } from "@fmerp/db";
import type { ServiceContext } from "./context";
import type { ServerDeps } from "./deps";
import type { AppEnv } from "./http";

/** 핸들러의 요청 문맥(c)에서 결재 서비스 호출 문맥을 만든다. tx는 withTenant 트랜잭션이다 */
type RequestContext = {
  get<K extends keyof AppEnv["Variables"]>(key: K): AppEnv["Variables"][K];
};

export function serviceContext(c: RequestContext, deps: ServerDeps, tx: Tx): ServiceContext {
  return {
    tx,
    storage: deps.storage,
    accountId: c.get("tenant").accountId,
    now: deps.now(),
    userId: c.get("session").userId,
    request: c.get("request"),
  };
}
