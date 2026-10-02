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
