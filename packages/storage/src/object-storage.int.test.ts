import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ObjectAlreadyExistsError, ObjectStorage } from "./object-storage";

const env = process.env;
const storage = new ObjectStorage({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION ?? "us-east-1",
  bucket: env.S3_BUCKET ?? "",
  accessKeyId: env.S3_ACCESS_KEY_ID ?? "",
  secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? "",
  forcePathStyle: true,
});

const testKey = (name: string) => `test/${randomUUID()}/${name}`;

describe("ObjectStorage 확장 (M4)", () => {
  it("범위 읽기와 전체 해시(SHA-256·크기)를 계산한다", async () => {
    const key = testKey("range.bin");
    await storage.put(key, "hello world", "application/octet-stream");
    expect(new TextDecoder().decode(await storage.getRange(key, 0, 4))).toBe("hello");
    const { sha256, size } = await storage.hashObject(key);
    expect(size).toBe(11);
    expect(sha256).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
  });

  it("복사는 도착 키가 이미 있으면 거부한다", async () => {
    const src = testKey("staging/a");
    const dst = testKey("final/a");
    await storage.put(src, "v1");
    await storage.copyIfAbsent(src, dst);
    expect(new TextDecoder().decode(await storage.getBytes(dst))).toBe("v1");
    await expect(storage.copyIfAbsent(src, dst)).rejects.toBeInstanceOf(ObjectAlreadyExistsError);
  });

  it("크기를 고정한 서명 URL: content-length가 서명에 포함되고, 선언한 크기의 업로드는 성공한다 (M1 FU-1)", async () => {
    const key = testKey("fixed.txt");
    const url = await storage.presignPutFixedSize(key, "text/plain", 5);
    // 서명된 헤더에 content-length가 있어 S3·R2는 다른 크기의 본문을 거부한다.
    // 로컬 SeaweedFS는 이를 강제하지 않으므로, 업로드 뒤 head로 실제 크기를 다시 확인하는 것이 서버의 방어선이다.
    expect(
      decodeURIComponent(new URL(url).searchParams.get("X-Amz-SignedHeaders") ?? ""),
    ).toContain("content-length");
    const exact = await fetch(url, {
      method: "PUT",
      body: "hello",
      headers: { "Content-Type": "text/plain" },
    });
    expect(exact.ok).toBe(true);
    expect(await storage.head(key)).toMatchObject({ size: 5 });
  });

  it("내려받기 서명 URL은 파일 이름 헤더를 붙일 수 있다", async () => {
    const key = testKey("dl.txt");
    await storage.put(key, "x", "text/plain");
    const res = await fetch(await storage.presignGet(key, 300, { downloadName: "한글 파일.txt" }));
    expect(res.headers.get("content-disposition")).toContain("UTF-8''");
  });
});

describe("ObjectStorage (로컬 S3)", () => {
  it("쓴 객체를 다시 읽을 수 있다", async () => {
    const key = testKey("doc.json");
    await storage.put(key, '{"a":1}', "application/json");
    expect(new TextDecoder().decode(await storage.getBytes(key))).toBe('{"a":1}');
    expect(await storage.head(key)).toMatchObject({ size: 7, contentType: "application/json" });
  });

  it("없는 키의 head는 null이다", async () => {
    expect(await storage.head(testKey("none"))).toBeNull();
  });

  it("putIfAbsent는 기존 키를 덮어쓰지 않는다 (write-once)", async () => {
    const key = testKey("final/document.json");
    await storage.putIfAbsent(key, "v1");
    await expect(storage.putIfAbsent(key, "v2")).rejects.toBeInstanceOf(ObjectAlreadyExistsError);
    expect(new TextDecoder().decode(await storage.getBytes(key))).toBe("v1");
  });

  it("서명 URL로 업로드하고 내려받을 수 있다", async () => {
    const key = testKey("upload.txt");
    const putUrl = await storage.presignPut(key, "text/plain");
    const put = await fetch(putUrl, {
      method: "PUT",
      body: "hello",
      headers: { "Content-Type": "text/plain" },
    });
    expect(put.ok).toBe(true);
    const get = await fetch(await storage.presignGet(key));
    expect(await get.text()).toBe("hello");
  });
});

describe("ObjectStorage 확장 (M7: 목록·스트림 업로드·태그)", () => {
  it("접두사로 객체를 나열한다 (페이지가 넘어가도 모두)", async () => {
    const prefix = `test/${randomUUID()}/list/`;
    const names = Array.from({ length: 5 }, (_, i) => `f${i}.txt`);
    for (const n of names) await storage.put(`${prefix}${n}`, `내용 ${n}`);
    await storage.put(`${prefix}sub/deep.txt`, "deep");
    const found: { key: string; size: number }[] = [];
    // 한 번에 2개씩 받아 여러 쪽을 이어 읽는지 확인한다
    for await (const o of storage.list(prefix, { pageSize: 2 })) found.push(o);
    expect(found.map((o) => o.key).sort()).toEqual(
      [...names.map((n) => `${prefix}${n}`), `${prefix}sub/deep.txt`].sort(),
    );
    expect(found.find((o) => o.key.endsWith("deep.txt"))?.size).toBe(4);
    const none: string[] = [];
    for await (const o of storage.list(`test/${randomUUID()}/없음/`)) none.push(o.key);
    expect(none).toEqual([]);
  });

  it("큰 본문을 스트림으로 올리고(멀티파트) 내려받아 해시가 같다", async () => {
    const key = testKey("big.bin");
    const parts = 4;
    const chunk = Buffer.alloc(3 * 1024 * 1024, 7); // 3MiB × 4 = 12MiB → 멀티파트(5MiB 이상)
    const { createHash } = await import("node:crypto");
    const expected = createHash("sha256");
    const { Readable } = await import("node:stream");
    const source = Readable.from(
      (async function* () {
        for (let i = 0; i < parts; i++) {
          expected.update(chunk);
          yield chunk;
        }
      })(),
    );
    await storage.putStream(key, source, "application/octet-stream");
    const { sha256, size } = await storage.hashObject(key);
    expect(size).toBe(chunk.length * parts);
    expect(sha256).toBe(expected.digest("hex"));
  }, 60_000);

  it("스트림 업로드도 키가 이미 있으면 덮어쓰지 않는다", async () => {
    const key = testKey("once.bin");
    const { Readable } = await import("node:stream");
    await storage.putStream(key, Readable.from([Buffer.from("첫 번째")]));
    await expect(
      storage.putStream(key, Readable.from([Buffer.from("두 번째")])),
    ).rejects.toBeInstanceOf(ObjectAlreadyExistsError);
    expect(new TextDecoder().decode(await storage.getBytes(key))).toBe("첫 번째");
  });

  it("태그를 붙이고 읽는다 (수명 주기 규칙이 태그로 지울 객체를 고른다)", async () => {
    const key = testKey("tag.bin");
    await storage.put(key, "x");
    expect(await storage.getTags(key)).toEqual({});
    await storage.setTags(key, { expire: "1" });
    expect(await storage.getTags(key)).toEqual({ expire: "1" });
  });
});
