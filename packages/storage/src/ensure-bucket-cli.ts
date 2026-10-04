// 개발용 로컬 S3(SeaweedFS)에 버킷이 없으면 만든다. `pnpm env:up`이 실행한다.
// 운영 버킷은 이 스크립트로 만들지 않는다: Object Lock 등 보호 설정이 필요해 DEPLOYMENT_PLAN 절차를 따른다.
import { BucketAlreadyOwnedByYou, CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";

const { S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env;

if (!S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
  console.error("S3_BUCKET·S3_ACCESS_KEY_ID·S3_SECRET_ACCESS_KEY가 필요합니다 (.env 확인)");
  process.exit(1);
}
if (!S3_ENDPOINT || !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(S3_ENDPOINT)) {
  console.error(
    `로컬 S3(localhost)에만 버킷을 만듭니다. 현재 S3_ENDPOINT=${S3_ENDPOINT ?? "(없음)"}`,
  );
  process.exit(1);
}

const client = new S3Client({
  endpoint: S3_ENDPOINT,
  region: S3_REGION ?? "us-east-1",
  forcePathStyle: true,
  credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
});
try {
  await client.send(new CreateBucketCommand({ Bucket: S3_BUCKET }));
  console.log(`버킷 생성: ${S3_BUCKET}`);
} catch (error) {
  if (error instanceof BucketAlreadyOwnedByYou) console.log(`버킷 이미 있음: ${S3_BUCKET}`);
  else throw error;
} finally {
  client.destroy();
}
