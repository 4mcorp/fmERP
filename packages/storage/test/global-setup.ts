import { BucketAlreadyOwnedByYou, CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import type { TestProject } from "vitest/node";

/** 통합 테스트 전에 로컬 S3(SeaweedFS)에 테스트 버킷을 만든다. */
export default async function setup(project: TestProject) {
  // test.env는 테스트 워커에만 주입되므로 globalSetup에서는 프로젝트 설정에서 직접 읽는다
  const env = project.config.env;
  const client = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION ?? "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? "",
    },
  });
  try {
    await client.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
  } catch (error) {
    if (!(error instanceof BucketAlreadyOwnedByYou)) throw error;
  } finally {
    client.destroy();
  }
}
