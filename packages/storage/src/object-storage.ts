import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import {
  CopyObjectCommand,
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
      // SDK 기본값(WHEN_SUPPORTED)은 서명 URL에 빈 본문의 CRC32를 넣어, 브라우저 직접 업로드가
      // BadDigest로 거부된다. R2·SeaweedFS 등 S3 호환 저장소에서는 필요할 때만 계산한다.
      // (docs/ts/2026-10-03-s3-presigned-checksum.md)
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
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

  /** 객체를 스트림으로 읽는다 (큰 파일을 통째로 메모리에 올리지 않고 ZIP 등으로 흘려보낼 때) */
  async getStream(key: string): Promise<Readable> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!result.Body) throw new Error(`객체 본문이 비어 있습니다: ${key}`);
    return result.Body as Readable;
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

  /** 객체 앞부분(start~end, 끝 포함)만 읽는다. 파일 형식(매직 바이트) 검사에 쓴다 (PRD FILE-002) */
  async getRange(key: string, start: number, endInclusive: number): Promise<Uint8Array> {
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Range: `bytes=${start}-${endInclusive}`,
      }),
    );
    if (!result.Body) throw new Error(`객체 본문이 비어 있습니다: ${key}`);
    return result.Body.transformToByteArray();
  }

  /** 객체 전체를 스트리밍으로 읽어 SHA-256(16진수)과 실제 크기를 계산한다 (PRD FILE-002) */
  async hashObject(key: string): Promise<{ sha256: string; size: number }> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!result.Body) throw new Error(`객체 본문이 비어 있습니다: ${key}`);
    const hash = createHash("sha256");
    let size = 0;
    for await (const chunk of result.Body as Readable) {
      hash.update(chunk as Uint8Array);
      size += (chunk as Uint8Array).length;
    }
    return { sha256: hash.digest("hex"), size };
  }

  /** 서버 안에서 객체를 복사한다. 도착 키가 이미 있으면 쓰지 않는다 (staging → 최종 키). */
  async copyIfAbsent(sourceKey: string, destinationKey: string): Promise<void> {
    if (await this.head(destinationKey)) throw new ObjectAlreadyExistsError(destinationKey);
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        CopySource: `${this.bucket}/${sourceKey}`,
        Key: destinationKey,
      }),
    );
  }

  /** 다운로드용 서명 URL. 권한 확인 후에만 발급한다 (PRD FILE-004). */
  presignGet(
    key: string,
    expiresInSeconds = 300,
    options: { downloadName?: string; inline?: boolean; contentType?: string } = {},
  ): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentType: options.contentType,
        ResponseContentDisposition: options.downloadName
          ? `attachment; filename*=UTF-8''${encodeURIComponent(options.downloadName)}`
          : options.inline
            ? "inline"
            : undefined,
      }),
      { expiresIn: expiresInSeconds },
    );
  }

  /**
   * 크기를 서명에 고정한 업로드용 서명 URL. 선언한 크기와 다른 본문은 서명 검증에서 거부된다 (M1 FU-1).
   * 호출한 쪽은 업로드 뒤에도 실제 크기를 `head`로 다시 확인한다.
   */
  presignPutFixedSize(
    key: string,
    contentType: string,
    size: number,
    expiresInSeconds = 300,
  ): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: size,
      }),
      { expiresIn: expiresInSeconds, signableHeaders: new Set(["content-length"]) },
    );
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
