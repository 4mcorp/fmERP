import { type Auth, createAuth, resolveDevTestLogin } from "@fmerp/auth";
import { createDatabase, type Db, pingDatabase } from "@fmerp/db";
import { ObjectStorage } from "@fmerp/storage";
import { getEnv } from "./env";
import { trustedIpHeaders } from "./http";

/** API가 쓰는 외부 자원. 테스트에서는 필요한 것만 바꿔 넣는다. */
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

let deps: ServerDeps | undefined;

/** 첫 요청 때 한 번만 만든다. 운영에서 테스트 로그인이 켜져 있으면 여기서 예외가 나 기동이 막힌다. */
export function getServerDeps(): ServerDeps {
  if (deps) return deps;
  const env = getEnv();
  const devTestLogin = resolveDevTestLogin(env);
  const app = createDatabase(env.DATABASE_URL);
  const authDb = createDatabase(env.AUTH_DATABASE_URL);
  deps = {
    appDb: app.db,
    authDb: authDb.db,
    auth: createAuth({
      db: authDb.db,
      baseURL: env.BETTER_AUTH_URL,
      secret: env.BETTER_AUTH_SECRET,
      devTestLogin,
      ipAddressHeaders: trustedIpHeaders(env.NODE_ENV),
    }),
    storage: new ObjectStorage({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      bucket: env.S3_BUCKET,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    }),
    devTestLogin,
    now: () => new Date(),
    pingDatabase: () => pingDatabase(app.pool),
  };
  return deps;
}
