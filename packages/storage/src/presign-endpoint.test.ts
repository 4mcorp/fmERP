import { describe, expect, it } from "vitest";
import { ObjectStorage } from "./object-storage";

const base = {
  region: "us-east-1",
  bucket: "fmerp-dev",
  accessKeyId: "k",
  secretAccessKey: "s",
  forcePathStyle: true,
};

describe("서명 URL 주소", () => {
  it("공개 주소가 있으면 서명 URL은 그 주소로 만든다", async () => {
    const storage = new ObjectStorage({
      ...base,
      endpoint: "http://s3:8333",
      publicEndpoint: "https://fmerp-dev.example.ts.net:8443",
    });
    const get = new URL(await storage.presignGet("a/b.pdf", 300, { downloadName: "x.pdf" }));
    const put = new URL(await storage.presignPut("a/b.pdf", "application/pdf"));
    const fixed = new URL(await storage.presignPutFixedSize("a/b.pdf", "application/pdf", 3));
    for (const url of [get, put, fixed]) {
      expect(url.origin).toBe("https://fmerp-dev.example.ts.net:8443");
      expect(url.pathname).toBe("/fmerp-dev/a/b.pdf");
    }
  });

  it("공개 주소가 없으면 기존 endpoint를 쓴다", async () => {
    const storage = new ObjectStorage({ ...base, endpoint: "http://localhost:58333" });
    expect(new URL(await storage.presignGet("k")).origin).toBe("http://localhost:58333");
  });
});
