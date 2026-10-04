import { afterAll, describe, expect, it } from "vitest";
import { closeBrowser, renderPdf } from "./render";

afterAll(() => closeBrowser());

const text = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");

describe("renderPdf (APV-063)", () => {
  it("HTML을 PDF로 바꾼다", { timeout: 60_000 }, async () => {
    const pdf = await renderPdf(
      "<!doctype html><html lang='ko'><body><h1>결재 문서</h1><p>한글 본문 테스트</p></body></html>",
    );
    expect(text(pdf.slice(0, 5))).toBe("%PDF-");
    expect(pdf.byteLength).toBeGreaterThan(1000);
    expect(text(pdf)).toContain("%%EOF");
  });

  it("외부 주소는 불러오지 않고 data URI 이미지만 쓴다", { timeout: 60_000 }, async () => {
    const tinyPng =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const started = Date.now();
    const pdf = await renderPdf(
      `<!doctype html><body><img src="${tinyPng}"><img src="http://203.0.113.1/never.png"></body>`,
    );
    expect(text(pdf.slice(0, 5))).toBe("%PDF-");
    // 막힌 외부 주소를 기다리느라 오래 걸리지 않는다
    expect(Date.now() - started).toBeLessThan(15_000);
  });

  it("스크립트는 실행하지 않는다", { timeout: 60_000 }, async () => {
    const pdf = await renderPdf(
      "<!doctype html><body><p id='x'>원본</p><script>document.getElementById('x').textContent='변조'</script></body>",
    );
    expect(text(pdf.slice(0, 5))).toBe("%PDF-");
  });
});
