import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { buildPdfHtml, type PdfInput } from "@fmerp/shared/domain/document-print";
import { type Browser, chromium } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadFontCss } from "../src/jobs/fonts";

const input = (): PdfInput =>
  JSON.parse(readFileSync(new URL("./fixtures/block-print.json", import.meta.url), "utf8"));
const baseline = readFileSync(
  new URL("./fixtures/block-print-legacy.html", import.meta.url),
  "utf8",
);
const fontDir = new URL("../../../apps/worker/fonts/", import.meta.url).pathname;
const fontCss = loadFontCss(fontDir);
let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch(process.platform === "darwin" ? { channel: "chrome" } : {});
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

function pageCount(bytes: Buffer) {
  return bytes.toString("latin1").match(/\/Type\s*\/Page\b/g)?.length ?? 0;
}

describe("블록 렌더러 실제 Chromium 배치", () => {
  it("웹폰트는 스크립트가 금지된 opaque srcdoc 미리보기에서도 로드된다", async () => {
    const page = await browser.newPage();
    const requests: string[] = [];
    const server = createServer((request, response) => {
      const file = request.url?.split("/").pop() ?? "";
      if (["Pretendard-Regular.woff2", "Pretendard-Bold.woff2"].includes(file)) {
        requests.push(file);
        response.writeHead(200, {
          "Content-Type": "font/woff2",
          "Access-Control-Allow-Origin": "*",
        });
        response.end(readFileSync(`${fontDir}/${file}`));
      } else {
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end('<iframe sandbox="" title="미리보기"></iframe>');
      }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("시험 서버 포트 없음");
    try {
      await page.goto(`http://127.0.0.1:${address.port}/`);
      await page.locator("iframe").evaluate((frame, html) => {
        (frame as HTMLIFrameElement).srcdoc = html;
      }, buildPdfHtml(input()));
      const preview = page.frameLocator("iframe");
      await preview.locator(".form-blocks").waitFor();
      const fonts = await preview.locator("body").evaluate(async () => {
        await document.fonts.ready;
        return [
          document.fonts.check('400 14px "Pretendard"'),
          document.fonts.check('700 14px "Pretendard"'),
        ];
      });
      expect(fonts).toEqual([true, true]);
      expect(requests.toSorted()).toEqual(["Pretendard-Bold.woff2", "Pretendard-Regular.woff2"]);
    } finally {
      await page.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 60_000);

  it("열 안의 수동 쪽 나눔도 실제 PDF 쪽을 넘긴다", async () => {
    const fixture = input();
    fixture.fontCss = fontCss;
    fixture.form.schema.fields = [];
    fixture.form.layout = {
      blocks: [
        {
          kind: "columns",
          cols: [
            [
              { kind: "text", text: "첫 쪽" },
              { kind: "pagebreak" },
              { kind: "text", text: "다음 쪽" },
            ],
            [{ kind: "text", text: "다른 열" }],
          ],
        },
      ],
    };
    const page = await browser.newPage();
    try {
      await page.setContent(buildPdfHtml(fixture));
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
      expect(pageCount(pdf)).toBe(2);
    } finally {
      await page.close();
    }
  }, 60_000);

  it("웹 woff2와 서버 PDF 글꼴은 승인된 동일 파일이다", () => {
    for (const file of ["Pretendard-Regular.woff2", "Pretendard-Bold.woff2", "OFL.txt"]) {
      const web = readFileSync(new URL(`../../../apps/web/public/fonts/${file}`, import.meta.url));
      expect(web.equals(readFileSync(`${fontDir}/${file}`)), file).toBe(true);
    }
    expect(fontCss).toContain("font-weight:400");
    expect(fontCss).toContain("font-weight:700");
  });

  it("기존 13종의 마크업과 세로·가로 배치를 dev 기준선 그대로 재현한다", async () => {
    const fixture = input();
    const html = buildPdfHtml({ ...fixture, fontCss });
    const oldFields = baseline
      .split('<div class="fields">')[1]
      ?.split('<div class="bottom-box')[0]
      ?.replace(/<\/div>\s*$/, "")
      .trim();
    const newFields = html
      .split('data-mode="print">')[1]
      ?.split('<div class="bottom-box')[0]
      ?.replace(/<\/div>\s*$/, "")
      .trim();
    expect(oldFields).toBeTruthy();
    expect(newFields).toBe(oldFields);
    const page = await browser.newPage();
    try {
      for (const width of [186, 273]) {
        for (const media of ["screen", "print"] as const) {
          await page.emulateMedia({ media });
          const metrics = [];
          for (const content of [baseline, html]) {
            await page.setContent(content);
            await page.addStyleTag({ content: `${fontCss} body { width: ${width}mm; }` });
            await page.evaluate(() => document.fonts.ready);
            metrics.push(
              await page.locator(".fields .field").evaluateAll((fields) =>
                fields.map((field) => {
                  const rect = field.getBoundingClientRect();
                  const label = field.querySelector(".label");
                  const style = getComputedStyle(field);
                  return {
                    text: field.textContent,
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                    display: style.display,
                    labelWidth: label?.getBoundingClientRect().width,
                    background: label && getComputedStyle(label).backgroundColor,
                  };
                }),
              ),
            );
          }
          expect(metrics[0]).toHaveLength(12);
          expect(metrics[1], `${width}mm ${media}`).toEqual(metrics[0]);
        }
      }
    } finally {
      await page.close();
    }
  }, 60_000);

  it("명시 블록은 단일 열·다중 열을 공유하고 수동 쪽 나눔을 실제 PDF에 적용한다", async () => {
    const fixture = input();
    fixture.fontCss = fontCss;
    fixture.form.schema.fields = fixture.form.schema.fields.slice(0, 2);
    fixture.form.layout = {
      blocks: [
        { kind: "heading", level: 1, text: "첫 페이지" },
        { kind: "field", key: "text" },
        { kind: "divider" },
        { kind: "pagebreak" },
        { kind: "heading", level: 2, text: "둘째 페이지" },
        {
          kind: "columns",
          cols: [[{ kind: "field", key: "textarea" }], [{ kind: "text", text: "오른쪽 설명" }]],
        },
      ],
    };
    const page = await browser.newPage();
    try {
      await page.setContent(buildPdfHtml(fixture));
      await page.evaluate(() => document.fonts.ready);
      const first = page.locator(".fields > .field");
      expect(await first.evaluate((field) => field.getBoundingClientRect().width)).toBe(
        await page.locator(".fields").evaluate((root) => root.getBoundingClientRect().width),
      );
      await page.emulateMedia({ media: "print" });
      expect(
        await page
          .locator(".block-pagebreak")
          .evaluate((node) => getComputedStyle(node).breakAfter),
      ).toBe("page");
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
      expect(pageCount(pdf)).toBe(2);
      expect(pdf.toString("latin1")).toContain("Pretendard");
      await page.setViewportSize({ width: 360, height: 800 });
      await page.emulateMedia({ media: "screen" });
      expect(
        await page
          .locator(".block-columns-scroll")
          .evaluate((node) => node.scrollWidth > node.clientWidth),
      ).toBe(true);
      expect(
        await page.locator(".block-columns-scroll").evaluate((node) => {
          node.scrollLeft = node.scrollWidth;
          return node.scrollLeft;
        }),
      ).toBeGreaterThan(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
    } finally {
      await page.close();
    }
  }, 60_000);
});
