// HTML → PDF (Playwright Chromium). 브라우저는 한 번 띄워 재사용하고, 작업마다 새 페이지를 연다.
import { type Browser, chromium } from "@playwright/test";

let browserPromise: Promise<Browser> | null = null;

function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ args: ["--disable-dev-shm-usage"] });
    // 브라우저가 죽으면 다음 작업에서 다시 띄운다
    browserPromise
      .then((b) => b.on("disconnected", () => (browserPromise = null)))
      .catch(() => {
        browserPromise = null;
      });
  }
  return browserPromise;
}

export async function renderPdf(html: string): Promise<Uint8Array> {
  const browser = await getBrowser();
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    // 외부 자원은 불러오지 않는다 (data URI만 쓴다)
    await page.route("**/*", (route) =>
      route.request().url().startsWith("data:") ? route.continue() : route.abort(),
    );
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    return new Uint8Array(pdf);
  } finally {
    await context.close();
  }
}

export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  const browser = await browserPromise.catch(() => null);
  browserPromise = null;
  await browser?.close();
}
