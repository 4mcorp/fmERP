import {
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface S3StorageConfig {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** 로컬 S3(SeaweedFS)처럼 가상 호스트 방식을 지원하지 않는 경우 true */
  forcePathStyle?: boolean;
}

export interface ObjectInfo {
  size: number;
  contentType?: string;
}

/** 이미 같은 키가 있어 쓰지 않았음을 나타낸다 (write-once 위반). */
export class ObjectAlreadyExistsError extends Error {
  constructor(readonly key: string) {
    super(`이미 존재하는 객체입니다: ${key}`);
    this.name = "ObjectAlreadyExistsError";
  }
}

/** S3 호환 저장소 어댑터. S3 SDK는 이 패키지 밖에서 쓰지 않는다 (docs/rules/storage-backup.md). */
export class ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3StorageConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  async put(key: string, body: Uint8Array | string, contentType?: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  /** 키가 없을 때만 쓴다. 완료 문서 패키지(final/)는 반드시 이 메서드로 쓴다 (PRD BAK-003). */
  async putIfAbsent(key: string, body: Uint8Array | string, contentType?: string): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          IfNoneMatch: "*",
        }),
      );
    } catch (error) {
      if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 412) {
        throw new ObjectAlreadyExistsError(key);
      }
      throw error;
    }
  }

  async getBytes(key: string): Promise<Uint8Array> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!result.Body) throw new Error(`객체 본문이 비어 있습니다: ${key}`);
    return result.Body.transformToByteArray();
  }

  async head(key: string): Promise<ObjectInfo | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return { size: result.ContentLength ?? 0, contentType: result.ContentType };
    } catch (error) {
      if (error instanceof NotFound) return null;
      throw error;
    }
  }

  /** 다운로드용 서명 URL. 권한 확인 후에만 발급한다 (PRD FILE-004). */
  presignGet(key: string, expiresInSeconds = 300): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: expiresInSeconds,
    });
  }

  /** 브라우저 직접 업로드용 서명 URL. */
  presignPut(key: string, contentType: string, expiresInSeconds = 300): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn: expiresInSeconds },
    );
  }
}
