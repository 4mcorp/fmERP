import { inflateSync } from "node:zlib";

function group(match: RegExpMatchArray, index: number): string {
  const value = match[index];
  if (value === undefined) throw new Error(`PDF token group ${index} 없음`);
  return value;
}

/** 이 시험의 Chromium/Skia PDF만 읽는다. 다른 인코딩은 성공으로 간주하지 않는다. */
export function pdfPages(bytes: Buffer): string[] {
  const objects = new Map(
    [...bytes.toString("latin1").matchAll(/(\d+) 0 obj\b([\s\S]*?)endobj/g)].map((m) => [
      Number(group(m, 1)),
      group(m, 2),
    ]),
  );
  function object(id: number) {
    const value = objects.get(id);
    if (!value) throw new Error(`PDF object ${id} 없음`);
    return value;
  }
  function stream(id: number) {
    const body = object(id);
    const data = /stream\r?\n([\s\S]*?)\r?\nendstream/.exec(body)?.[1];
    if (data === undefined) throw new Error(`PDF stream ${id} 없음`);
    return body.includes("/FlateDecode")
      ? inflateSync(Buffer.from(data, "latin1")).toString("latin1")
      : data;
  }
  const maps = new Map<number, Map<number, string>>();
  for (const [id, body] of objects) {
    const ref = /\/ToUnicode (\d+) 0 R/.exec(body);
    if (!ref) continue;
    const cmap = stream(Number(ref[1]));
    const chars = new Map<number, string>();
    const unicode = (hex: string) =>
      (hex.match(/.{4}/g) ?? []).map((c) => String.fromCharCode(Number.parseInt(c, 16))).join("");
    for (const section of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const m of group(section, 1).matchAll(/<([\da-f]+)>\s*<([\da-f]+)>/gi))
        chars.set(Number.parseInt(group(m, 1), 16), unicode(group(m, 2)));
    }
    for (const section of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      for (const m of group(section, 1).matchAll(/<([\da-f]+)>\s*<([\da-f]+)>\s*<([\da-f]+)>/gi)) {
        const start = Number.parseInt(group(m, 1), 16);
        const end = Number.parseInt(group(m, 2), 16);
        for (let code = start; code <= end; code++)
          chars.set(code, String.fromCharCode(Number.parseInt(group(m, 3), 16) + code - start));
      }
    }
    if (cmap.includes("[")) throw new Error("시험 PDF가 지원하지 않는 CMap range 배열");
    maps.set(id, chars);
  }
  const catalog = [...objects.values()].find((body) => /\/Type \/Catalog\b/.test(body));
  const root = catalog && /\/Pages (\d+) 0 R/.exec(catalog);
  if (!root) throw new Error("PDF page tree 없음");
  function pages(id: number): string[] {
    const body = object(id);
    if (/\/Type \/Pages\b/.test(body)) {
      const kids = /\/Kids \[([^\]]+)\]/.exec(body)?.[1] ?? "";
      return [...kids.matchAll(/(\d+) 0 R/g)].flatMap((m) => pages(Number(group(m, 1))));
    }
    const fonts = new Map(
      [...body.matchAll(/\/(F\d+) (\d+) 0 R/g)].map((m) => [
        group(m, 1),
        maps.get(Number(group(m, 2))),
      ]),
    );
    const contents = /\/Contents (\d+) 0 R/.exec(body);
    if (!contents) throw new Error("시험 PDF가 지원하지 않는 Contents");
    let font: Map<number, string> | undefined;
    let text = "";
    for (const token of stream(Number(contents[1])).matchAll(
      /\/(F\d+) [\d.]+ Tf|<([\da-f]+)>\s*Tj|\bET\b/gi,
    )) {
      if (token[1]) font = fonts.get(token[1]);
      else if (token[2]) {
        if (!font) throw new Error("PDF Unicode font 없음");
        for (const hex of token[2].match(/.{4}/g) ?? []) {
          const char = font.get(Number.parseInt(hex, 16));
          if (char === undefined) throw new Error(`PDF glyph ${hex} 없음`);
          text += char;
        }
      } else text += "\n";
    }
    if (!text.trim()) throw new Error("PDF text 없음");
    return [text];
  }
  return pages(Number(root[1]));
}
