import { once } from "node:events";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { FORM_PAGE_GUIDE_MARGIN_MM } from "@fmerp/shared/domain/document-preview-scale";
import { buildPdfHtml, type PdfInput } from "@fmerp/shared/domain/document-print";
import { type Browser, chromium } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadFontCss } from "../src/jobs/fonts";
import { pdfPages } from "./fixtures/chromium-pdf";

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
  it.each(["portrait", "landscape"] as const)(
    "%s Pretendard 쪽 경계를 실제 PDF 마커와 대조한다",
    async (orientation) => {
      const fixture = input();
      fixture.fontCss = fontCss;
      fixture.form.schema.fields = Array.from({ length: 70 }, (_, index) => ({
        key: `f${index}`,
        type: "text",
        label: `항목 ${index}`,
      }));
      fixture.values = Object.fromEntries(
        Array.from({ length: 70 }, (_, index) => [
          `f${index}`,
          `B${String(index).padStart(3, "0")} 한글 경계 ${"본문 내용 ".repeat(index % 9)}`,
        ]),
      );
      fixture.form.layout = {
        orientation,
        blocks: Array.from({ length: 70 }, (_, index) =>
          index % 3 === 0
            ? {
                kind: "columns" as const,
                cols: [
                  [{ kind: "field" as const, key: `f${index}` }],
                  [{ kind: "text" as const, text: "오른쪽 열 확인" }],
                ],
              }
            : { kind: "field" as const, key: `f${index}` },
        ),
      };
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      try {
        await page.setContent(buildPdfHtml(fixture));
        await page.addStyleTag({
          content: `body { width: ${orientation === "portrait" ? 186 : 273}mm; }`,
        });
        await page.evaluate(() => document.fonts.ready);
        const metrics = await page.locator(".form-blocks > *").evaluateAll((nodes) => ({
          header: nodes[0]?.getBoundingClientRect().top ?? 0,
          blocks: nodes.map((node) => {
            const style = getComputedStyle(node);
            return {
              height: node.getBoundingClientRect().height,
              top: node.getBoundingClientRect().top,
              margin: Math.max(
                Number.parseFloat(style.marginTop),
                Number.parseFloat(style.marginBottom),
              ),
            };
          }),
        }));
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
        const pages = pdfPages(pdf);
        const actual = pages.flatMap((text, page) =>
          [...text.matchAll(/B(\d{3})/g)].map((match) => ({
            index: Number(match[1]),
            page: page + 1,
          })),
        );
        // Skia는 grid 텍스트를 같은 페이지의 일반 필드 뒤에 그린다. 그리기 순서가 아닌 키별 페이지를 비교한다.
        actual.sort((a, b) => a.index - b.index);
        expect(actual.map((marker) => marker.index)).toEqual(
          Array.from({ length: 70 }, (_, i) => i),
        );
        expect(actual.map((marker) => marker.page)).toEqual(
          actual.map((marker) => marker.page).toSorted((a, b) => a - b),
        );
        const measurements = [0, 3, 5, 8, 10, 12].map((margin) => {
          const height = (((orientation === "portrait" ? 269 : 182) - margin) * 96) / 25.4;
          let page = 1;
          let used = metrics.header;
          const predicted = metrics.blocks.map((block) => {
            if (used + block.height > height) {
              page++;
              used = 0;
            }
            used += block.height + block.margin;
            return page;
          });
          return {
            margin,
            fixedGuideUnsafe: actual.filter(
              (marker) =>
                Math.floor((metrics.blocks[marker.index]?.top ?? 0) / height) + 1 < marker.page,
            ),
            fixedGuideEarly: actual.filter(
              (marker) =>
                Math.floor((metrics.blocks[marker.index]?.top ?? 0) / height) + 1 > marker.page,
            ),
            unsafe: actual.filter((marker) => (predicted[marker.index] ?? 0) < marker.page),
            early: actual.filter((marker) => (predicted[marker.index] ?? 0) > marker.page),
          };
        });
        console.info(JSON.stringify({ orientation, pages: pages.length, measurements }));
        const dir = process.env.FORM_PDF_ARTIFACTS;
        if (dir) {
          mkdirSync(dir, { recursive: true });
          writeFileSync(`${dir}/${orientation}-boundary.pdf`, pdf);
          writeFileSync(
            `${dir}/${orientation}-boundary.json`,
            JSON.stringify({ metrics, actual, measurements }, null, 2),
          );
        }
        expect(
          measurements.find((m) => m.margin === FORM_PAGE_GUIDE_MARGIN_MM)?.fixedGuideUnsafe,
        ).toEqual([]);
      } finally {
        await page.close();
      }
    },
    60_000,
  );
  it.each([2, 3, 4])(
    "%i열의 긴 표·거대 단일 행·리치텍스트를 PDF에서 빠짐없이 분할한다",
    async (columns) => {
      for (const orientation of ["portrait", "landscape"] as const) {
        const fixture = input();
        fixture.fontCss = fontCss;
        fixture.form.schema.fields = [
          {
            key: "rows",
            label: "행 목록",
            type: "table",
            columns: [{ key: "item", label: "ROWHEADER", type: "text" }],
          },
          {
            key: "giant",
            label: "거대 행",
            type: "table",
            columns: [{ key: "item", label: "GIANTHEADER", type: "text" }],
          },
          { key: "rich", label: "긴 본문", type: "richtext" },
        ];
        fixture.values = {
          rows: Array.from({ length: 60 }, (_, i) => ({
            item: `R${String(i).padStart(3, "0")} 시작 한글 행 끝 E${String(i).padStart(3, "0")}`,
          })),
          giant: [
            {
              item: Array.from(
                { length: 100 },
                (_, i) => `G${String(i).padStart(3, "0")} ${"한글 강제 분할 ".repeat(4)}`,
              ).join("\n"),
            },
          ],
          rich: {
            type: "doc",
            content: Array.from({ length: 30 }, (_, i) => ({
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: `P${String(i).padStart(3, "0")} 한글 문단 내용 끝 Q${String(i).padStart(3, "0")}`,
                },
              ],
            })),
          },
        };
        fixture.form.layout = {
          orientation,
          blocks: [
            { kind: "heading", level: 1, text: "시나리오 시작" },
            {
              kind: "columns",
              cols: Array.from({ length: columns }, (_, i) =>
                i === 0
                  ? [{ kind: "field" as const, key: "rows" }]
                  : i === 1
                    ? [{ kind: "field" as const, key: "rich" }]
                    : [{ kind: "text" as const, text: `오른쪽 열 ${i}` }],
              ),
            },
            { kind: "pagebreak" },
            { kind: "text", text: "MANUALSTART" },
            {
              kind: "columns",
              cols: Array.from({ length: columns }, (_, i) =>
                i === 0
                  ? [{ kind: "field" as const, key: "giant" }]
                  : [{ kind: "text" as const, text: `거대 행 옆 열 ${i}` }],
              ),
            },
            { kind: "text", text: "DOCUMENTEND" },
          ],
        };
        const page = await browser.newPage();
        try {
          await page.setContent(buildPdfHtml(fixture));
          await page.evaluate(() => document.fonts.ready);
          const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
          const pages = pdfPages(pdf);
          const text = pages.join("\n");
          for (const [prefix, count] of [
            ["R", 60],
            ["E", 60],
            ["G", 100],
            ["P", 30],
            ["Q", 30],
          ] as const) {
            const markers = [...text.matchAll(new RegExp(`${prefix}(\\d{3})`, "g"))].map((m) =>
              Number(m[1]),
            );
            expect(markers, `${orientation}/${columns}/${prefix}`).toEqual(
              Array.from({ length: count }, (_, i) => i),
            );
          }
          for (let i = 0; i < 60; i++) {
            const marker = String(i).padStart(3, "0");
            const rowPage = pages.findIndex((text) => text.includes(`R${marker}`));
            expect(pages[rowPage], `행 ${i} 분리`).toContain(`E${marker}`);
            expect(pages[rowPage], `행 ${i} 머리글`).toContain("ROWHEADER");
          }
          for (let i = 0; i < 30; i++) {
            const marker = String(i).padStart(3, "0");
            expect(pages.find((text) => text.includes(`P${marker}`))).toContain(`Q${marker}`);
          }
          const manualPage = pages.findIndex((text) => text.includes("MANUALSTART"));
          expect(manualPage).toBeGreaterThan(pages.findIndex((text) => text.includes("R059")));
          expect(pages.findIndex((text) => text.includes("G099"))).toBeGreaterThan(manualPage);
          expect(text.match(/DOCUMENTEND/g)).toHaveLength(1);
          expect(text).toContain("한글");
          const dir = process.env.FORM_PDF_ARTIFACTS;
          if (dir) {
            mkdirSync(dir, { recursive: true });
            writeFileSync(`${dir}/${orientation}-${columns}cols.pdf`, pdf);
            writeFileSync(
              `${dir}/${orientation}-${columns}cols.json`,
              JSON.stringify(pages, null, 2),
            );
          }
        } finally {
          await page.close();
        }
      }
    },
    60_000,
  );

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
      const decoded = pdfPages(pdf);
      expect(decoded).toHaveLength(2);
      expect(decoded[0]).toContain("첫 쪽");
      expect(decoded[0]).not.toContain("다음 쪽");
      expect(decoded[1]).toContain("다음 쪽");
      expect(() => pdfPages(Buffer.from("not a PDF"))).toThrow("PDF page tree 없음");
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
