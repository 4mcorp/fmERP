/** 첨부 파일 형식 검사 (PRD FILE-002). 확장자만 믿지 않고 파일 앞부분(매직 바이트)을 본다. 순수 함수 */

export type SniffKind =
  | "png"
  | "jpeg"
  | "gif"
  | "webp"
  | "pdf"
  | "zip"
  | "ole"
  | "text"
  | "executable"
  | "unknown";

const startsWith = (b: Uint8Array, sig: number[], offset = 0) =>
  b.length >= offset + sig.length && sig.every((v, i) => b[offset + i] === v);
const ascii = (b: Uint8Array, start: number, text: string) =>
  b.length >= start + text.length && [...text].every((c, i) => b[start + i] === c.charCodeAt(0));

export function sniffFile(head: Uint8Array): SniffKind {
  // 실행 파일은 확장자와 상관없이 먼저 잡는다: PE(MZ), ELF, Mach-O, Java class, 스크립트(#!)
  if (
    ascii(head, 0, "MZ") ||
    startsWith(head, [0x7f, 0x45, 0x4c, 0x46]) ||
    startsWith(head, [0xcf, 0xfa, 0xed, 0xfe]) ||
    startsWith(head, [0xce, 0xfa, 0xed, 0xfe]) ||
    startsWith(head, [0xca, 0xfe, 0xba, 0xbe]) ||
    ascii(head, 0, "#!")
  ) {
    return "executable";
  }
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(head, [0xff, 0xd8, 0xff])) return "jpeg";
  if (ascii(head, 0, "GIF87a") || ascii(head, 0, "GIF89a")) return "gif";
  if (ascii(head, 0, "RIFF") && ascii(head, 8, "WEBP")) return "webp";
  if (ascii(head, 0, "%PDF-")) return "pdf";
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04]) || startsWith(head, [0x50, 0x4b, 0x05, 0x06]))
    return "zip";
  if (startsWith(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "ole";
  // 텍스트: 제어 문자(탭·줄바꿈 제외)와 NUL이 없으면 텍스트로 본다
  const looksText =
    head.length > 0 && head.every((v) => v === 9 || v === 10 || v === 13 || v >= 32);
  return looksText ? "text" : "unknown";
}

interface TypeInfo {
  kinds: SniffKind[];
  mime: string;
}

const TYPES: Record<string, TypeInfo> = {
  pdf: { kinds: ["pdf"], mime: "application/pdf" },
  png: { kinds: ["png"], mime: "image/png" },
  jpg: { kinds: ["jpeg"], mime: "image/jpeg" },
  jpeg: { kinds: ["jpeg"], mime: "image/jpeg" },
  gif: { kinds: ["gif"], mime: "image/gif" },
  webp: { kinds: ["webp"], mime: "image/webp" },
  txt: { kinds: ["text"], mime: "text/plain" },
  csv: { kinds: ["text"], mime: "text/csv" },
  zip: { kinds: ["zip"], mime: "application/zip" },
  docx: {
    kinds: ["zip"],
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  xlsx: {
    kinds: ["zip"],
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  pptx: {
    kinds: ["zip"],
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  },
  hwpx: { kinds: ["zip"], mime: "application/vnd.hancom.hwpx" },
  doc: { kinds: ["ole"], mime: "application/msword" },
  xls: { kinds: ["ole"], mime: "application/vnd.ms-excel" },
  ppt: { kinds: ["ole"], mime: "application/vnd.ms-powerpoint" },
  hwp: { kinds: ["ole"], mime: "application/x-hwp" },
};

/** 계정 정책이 없을 때 허용하는 확장자. 실행 파일·스크립트는 포함하지 않는다 */
export const DEFAULT_ALLOWED_EXTENSIONS: readonly string[] = Object.keys(TYPES);

export function extensionOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i <= 0 || i === filename.length - 1 ? "" : filename.slice(i + 1).toLowerCase();
}

/** 저장 키·다운로드 이름에 쓸 안전한 파일 이름: 경로·제어 문자를 지우고 길이를 제한한다 */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 제어 문자를 제거하려는 것이다
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (cleaned === "" || cleaned === "." || cleaned === "..") return "file";
  if (cleaned.length <= 120) return cleaned;
  const ext = extensionOf(cleaned);
  return ext ? `${cleaned.slice(0, 120 - ext.length - 1)}.${ext}` : cleaned.slice(0, 120);
}

export type AttachmentCheck = { ok: true; mime: string } | { ok: false; reason: string };

export function checkAttachment(input: {
  filename: string;
  /** 파일 앞부분 (4KB 정도) */
  head: Uint8Array;
  /** 계정 정책의 허용 확장자. 없으면 기본 목록 */
  allowedExtensions?: readonly string[];
}): AttachmentCheck {
  const ext = extensionOf(input.filename);
  if (ext === "") return { ok: false, reason: "확장자가 없는 파일은 올릴 수 없습니다" };
  const allowed = (input.allowedExtensions ?? DEFAULT_ALLOWED_EXTENSIONS).map((e) =>
    e.toLowerCase(),
  );
  const info = TYPES[ext];
  if (!allowed.includes(ext) || !info)
    return { ok: false, reason: `허용되지 않는 파일 형식입니다 (.${ext})` };
  if (input.head.length === 0) return { ok: false, reason: "빈 파일은 올릴 수 없습니다" };
  const kind = sniffFile(input.head);
  if (kind === "executable") return { ok: false, reason: "실행 파일은 올릴 수 없습니다" };
  if (!info.kinds.includes(kind)) {
    return { ok: false, reason: `파일 내용이 확장자(.${ext})와 맞지 않습니다` };
  }
  return { ok: true, mime: info.mime };
}
