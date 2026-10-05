// 운영자 CLI 공통: `--name=value`·`--flag` 인자 읽기
export function parseArgs(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (const a of argv) {
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq < 0) out[a.slice(2)] = true;
    else out[a.slice(2, eq)] = a.slice(eq + 1);
  }
  return out;
}

export function need(args: Record<string, string | true>, name: string): string {
  const v = args[name];
  if (typeof v !== "string" || v === "") {
    console.error(`--${name}=<값>이 필요합니다`);
    process.exit(2);
  }
  return v;
}
