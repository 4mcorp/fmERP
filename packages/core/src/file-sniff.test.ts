import { describe, expect, it } from "vitest";
import {
  checkAttachment,
  DEFAULT_ALLOWED_EXTENSIONS,
  extensionOf,
  safeFileName,
  sniffFile,
} from "./file-sniff";

// core의 tsconfig에는 DOM·Node 타입이 없어 테스트에서만 쓰는 TextEncoder를 선언한다
declare const TextEncoder: new () => { encode(input: string): Uint8Array };
const bytes = (...values: number[]) => Uint8Array.from(values);
const text = (s: string) => new TextEncoder().encode(s);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0);
const PDF = text("%PDF-1.7\n...");
const JPG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10);
const ZIP = bytes(0x50, 0x4b, 0x03, 0x04, 0, 0);
const OLE = bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
const EXE = bytes(0x4d, 0x5a, 0x90, 0x00, 3, 0);
const ELF = bytes(0x7f, 0x45, 0x4c, 0x46, 2, 1);
const WEBP = (() => {
  const b = new Uint8Array(16);
  b.set(text("RIFF"), 0);
  b.set(text("WEBP"), 8);
  return b;
})();

describe("파일 형식 판별 (FILE-002)", () => {
  it("매직 바이트로 형식을 알아낸다", () => {
    expect(sniffFile(PNG)).toBe("png");
    expect(sniffFile(PDF)).toBe("pdf");
    expect(sniffFile(JPG)).toBe("jpeg");
    expect(sniffFile(WEBP)).toBe("webp");
    expect(sniffFile(ZIP)).toBe("zip");
    expect(sniffFile(OLE)).toBe("ole");
    expect(sniffFile(text("GIF89a...."))).toBe("gif");
    expect(sniffFile(EXE)).toBe("executable");
    expect(sniffFile(ELF)).toBe("executable");
    expect(sniffFile(text("#!/bin/sh\necho hi"))).toBe("executable");
    expect(sniffFile(text("그냥 텍스트,1,2\n"))).toBe("text");
    expect(sniffFile(bytes(0, 1, 2, 3, 0, 0, 9, 9))).toBe("unknown");
  });
});

describe("첨부 검사 (확장자 위장 차단)", () => {
  const ok = (name: string, head: Uint8Array) => checkAttachment({ filename: name, head });

  it("확장자와 실제 형식이 맞으면 통과하고 MIME을 돌려준다", () => {
    expect(ok("a.pdf", PDF)).toEqual({ ok: true, mime: "application/pdf" });
    expect(ok("a.PNG", PNG)).toEqual({ ok: true, mime: "image/png" });
    expect(ok("a.jpg", JPG)).toMatchObject({ ok: true, mime: "image/jpeg" });
    expect(ok("a.docx", ZIP)).toMatchObject({ ok: true });
    expect(ok("a.xls", OLE)).toMatchObject({ ok: true });
    expect(ok("a.hwp", OLE)).toMatchObject({ ok: true });
    expect(ok("a.csv", text("a,b\n1,2"))).toMatchObject({ ok: true, mime: "text/csv" });
  });

  it("PDF·이미지로 위장한 실행 파일과 형식 불일치를 거부한다", () => {
    expect(ok("invoice.pdf", EXE)).toMatchObject({ ok: false });
    expect(ok("photo.png", ELF)).toMatchObject({ ok: false });
    expect(ok("photo.png", PDF)).toMatchObject({ ok: false });
    expect(ok("notes.txt", EXE)).toMatchObject({ ok: false });
    expect(ok("doc.pdf", text("<html><script>alert(1)</script>"))).toMatchObject({ ok: false });
  });

  it("실행 파일 확장자와 허용되지 않은 확장자는 거부한다", () => {
    expect(ok("run.exe", EXE)).toMatchObject({ ok: false });
    expect(ok("run.bat", text("echo hi"))).toMatchObject({ ok: false });
    expect(ok("noext", PDF)).toMatchObject({ ok: false });
    expect(ok("a.weird", text("x"))).toMatchObject({ ok: false });
  });

  it("계정 정책의 허용 확장자 목록을 따른다", () => {
    expect(
      checkAttachment({ filename: "a.pdf", head: PDF, allowedExtensions: ["png"] }),
    ).toMatchObject({ ok: false });
    expect(
      checkAttachment({ filename: "a.png", head: PNG, allowedExtensions: ["png"] }),
    ).toMatchObject({ ok: true });
    // 정책이 실행 파일 확장자를 허용해도 실행 파일 내용은 막는다
    expect(
      checkAttachment({ filename: "a.exe", head: EXE, allowedExtensions: ["exe"] }),
    ).toMatchObject({ ok: false });
  });

  it("빈 파일은 거부한다", () => {
    expect(ok("a.txt", new Uint8Array())).toMatchObject({ ok: false });
  });
});

describe("파일 이름", () => {
  it("확장자 추출", () => {
    expect(extensionOf("a.b.PDF")).toBe("pdf");
    expect(extensionOf("noext")).toBe("");
    expect(extensionOf(".hidden")).toBe("");
  });

  it("경로·제어 문자를 제거하고 길이를 제한한다", () => {
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("보고서 최종.pdf")).toBe("보고서 최종.pdf");
    expect(safeFileName("a\u0000b\nc.txt")).toBe("abc.txt");
    expect(safeFileName("a".repeat(300) + ".pdf").length).toBeLessThanOrEqual(120);
    expect(safeFileName("a".repeat(300) + ".pdf").endsWith(".pdf")).toBe(true);
    expect(safeFileName("   ")).toBe("file");
  });

  it("기본 허용 확장자에 실행 파일이 없다", () => {
    for (const ext of [
      "exe",
      "bat",
      "cmd",
      "js",
      "sh",
      "msi",
      "dll",
      "ps1",
      "vbs",
      "jar",
      "scr",
      "com",
    ]) {
      expect(DEFAULT_ALLOWED_EXTENSIONS).not.toContain(ext);
    }
  });
});
