import type { Auth } from "@fmerp/auth";
import type { Db } from "@fmerp/db";
import type { ObjectStorage } from "@fmerp/storage";

/** API가 쓰는 외부 자원. 테스트에서는 필요한 것만 바꿔 넣는다. 실제 연결은 합성 루트의 getServerDeps가 만든다 */
export interface ServerDeps {
  /** fmerp_app — 업무 데이터, RLS 적용 */
  appDb: Db;
  /** fmerp_auth — 인증·계정, RLS 우회 (ADR 0005) */
  authDb: Db;
  auth: Auth;
  storage: ObjectStorage;
  devTestLogin: boolean;
  now: () => Date;
  pingDatabase: () => Promise<void>;
}
