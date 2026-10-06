import type { Db } from "@fmerp/db";
import type { ObjectStorage } from "@fmerp/storage";

/** 계정 기능이 만든 인증 처리기를 공통 영역이 불투명하게 들고 있기 위한 최소 모양 (공통→기능 import를 피한다) */
interface AuthHandle {
  handler(request: Request): Promise<Response>;
  api: {
    getSession(options: { headers: Headers }): Promise<{ session: { id: string } } | null>;
  };
}

/** API가 쓰는 외부 자원. 테스트에서는 필요한 것만 바꿔 넣는다. 실제 연결은 합성 루트의 getServerDeps가 만든다 */
export interface ServerDeps {
  /** fmerp_app — 업무 데이터, RLS 적용 */
  appDb: Db;
  /** fmerp_auth — 인증·계정, RLS 우회 (ADR 0005) */
  authDb: Db;
  /** 로그인 처리기. 실제 타입(Better Auth)은 계정 기능이 알고, 거기서만 좁혀 쓴다 */
  auth: AuthHandle;
  storage: ObjectStorage;
  devTestLogin: boolean;
  now: () => Date;
  pingDatabase: () => Promise<void>;
}
