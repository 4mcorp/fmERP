import { createDatabase, pingDatabase } from "@fmerp/db";
import { createAuth, resolveDevTestLogin } from "@fmerp/feature-account/auth-setup";
import type { ServerDeps } from "@fmerp/shared/server/deps";
import { getEnv } from "@fmerp/shared/server/env";
import { trustedIpHeaders } from "@fmerp/shared/server/http";
import { ObjectStorage } from "@fmerp/storage";

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
      publicEndpoint: env.S3_PUBLIC_ENDPOINT,
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
