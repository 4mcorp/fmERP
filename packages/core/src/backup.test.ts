import { describe, expect, it } from "vitest";
import {
  backupHealth,
  buildExportManifest,
  changeToken,
  csvCell,
  isSystemAdmin,
  safeEntryName,
  shouldSkipDump,
  toCsv,
} from "./backup";

const kst = (s: string) => new Date(`${s}+09:00`);
const ok = (finishedAt: string, status = "SUCCEEDED", kind = "auto") => ({
  status,
  kind,
  finishedAt: kst(finishedAt),
});

describe("백업 상태 판정 (BAK-005, 03:30 KST까지 성공 신호)", () => {
  it("오늘 03:00 이후 성공이 있으면 정상", () => {
    const h = backupHealth(kst("2026-10-05T10:00:00"), [ok("2026-10-05T03:02:00")]);
    expect(h.state).toBe("ok");
    expect(h.lastSuccessAt?.toISOString()).toBe(kst("2026-10-05T03:02:00").toISOString());
  });

  it("건너뜀(SKIPPED)도 성공 신호다", () => {
    expect(
      backupHealth(kst("2026-10-05T10:00:00"), [ok("2026-10-05T03:01:00", "SKIPPED")]).state,
    ).toBe("ok");
  });

  it("03:30이 지났는데 오늘 성공이 없으면 누락", () => {
    const h = backupHealth(kst("2026-10-05T03:31:00"), [ok("2026-10-04T03:02:00")]);
    expect(h.state).toBe("overdue");
    expect(h.expectedBy.toISOString()).toBe(kst("2026-10-05T03:30:00").toISOString());
  });

  it("03:30 전에는 어제 성공만 있어도 정상 (아직 기한 전)", () => {
    expect(backupHealth(kst("2026-10-05T03:29:00"), [ok("2026-10-04T03:02:00")]).state).toBe("ok");
  });

  it("03:30 전인데 어제 기한도 놓쳤으면 누락", () => {
    expect(backupHealth(kst("2026-10-05T01:00:00"), [ok("2026-10-03T03:02:00")]).state).toBe(
      "overdue",
    );
  });

  it("실패한 덤프는 성공 신호가 아니다", () => {
    expect(
      backupHealth(kst("2026-10-05T04:00:00"), [ok("2026-10-05T03:05:00", "FAILED")]).state,
    ).toBe("overdue");
  });

  it("성공 기록이 하나도 없으면 첫 기한이 지나면 누락", () => {
    const h = backupHealth(kst("2026-10-05T04:00:00"), []);
    expect(h.state).toBe("overdue");
    expect(h.lastSuccessAt).toBeNull();
  });

  it("수동 덤프도 성공 신호로 센다", () => {
    expect(
      backupHealth(kst("2026-10-05T04:00:00"), [ok("2026-10-05T03:40:00", "SUCCEEDED", "manual")])
        .state,
    ).toBe("ok");
  });

  it("끝나지 않은(finishedAt 없는) 행은 무시한다", () => {
    expect(
      backupHealth(kst("2026-10-05T04:00:00"), [
        { status: "SUCCEEDED", kind: "auto", finishedAt: null },
      ]).state,
    ).toBe("overdue");
  });

  it("UTC 날짜가 달라도 한국 시간 기준으로 하루를 센다", () => {
    // 2026-10-04T18:10Z = 2026-10-05 03:10 KST
    const h = backupHealth(new Date("2026-10-04T19:00:00Z"), [ok("2026-10-05T03:10:00")]);
    expect(h.state).toBe("ok");
  });
});

describe("변경 토큰 (변경 없으면 덤프를 건너뜀)", () => {
  it("테이블별 삽입·수정·삭제 수의 합으로 만든다", () => {
    expect(
      changeToken([
        { ins: 1n, upd: 2n, del: 3n },
        { ins: 10n, upd: 0n, del: 0n },
      ]),
    ).toBe("16");
    expect(changeToken([])).toBe("0");
  });

  it("큰 수도 정확하다", () => {
    expect(changeToken([{ ins: 9007199254740993n, upd: 1n, del: 0n }])).toBe("9007199254740994");
  });

  it("직전 토큰과 같을 때만 건너뛴다", () => {
    expect(shouldSkipDump("100", "100")).toBe(true);
    expect(shouldSkipDump("100", "101")).toBe(false);
    // 통계가 초기화돼 줄어들면 덤프한다
    expect(shouldSkipDump("100", "5")).toBe(false);
  });

  it("토큰을 모르면 덤프한다", () => {
    expect(shouldSkipDump(null, "100")).toBe(false);
    expect(shouldSkipDump("100", null)).toBe(false);
    expect(shouldSkipDump(null, null)).toBe(false);
  });
});

describe("시스템 관리자 판정 (M7 Q1)", () => {
  const list = "Admin@Example.com, ops@example.com ,";
  it("목록의 이메일과 인증된 로그인 이메일이 일치하면 시스템 관리자 (대소문자·공백 무시)", () => {
    expect(isSystemAdmin("admin@example.com", true, list)).toBe(true);
    expect(isSystemAdmin(" OPS@example.com ", true, list)).toBe(true);
  });

  it("이메일 인증이 안 됐거나 목록에 없거나 목록이 비면 아니다", () => {
    expect(isSystemAdmin("admin@example.com", false, list)).toBe(false);
    expect(isSystemAdmin("other@example.com", true, list)).toBe(false);
    expect(isSystemAdmin("admin@example.com", true, "")).toBe(false);
    expect(isSystemAdmin("admin@example.com", true, undefined)).toBe(false);
    expect(isSystemAdmin("", true, ",")).toBe(false);
  });

  it("부분 일치는 허용하지 않는다", () => {
    expect(isSystemAdmin("admin@example.com.evil.io", true, list)).toBe(false);
    expect(isSystemAdmin("xadmin@example.com", true, list)).toBe(false);
  });
});

describe("내보내기 CSV (수식 주입 방어)", () => {
  it("수식으로 읽힐 시작 글자는 작은따옴표로 막고 쉼표·따옴표는 감싼다", () => {
    for (const bad of ["=1+1", "+1", "-1", "@SUM(A1)", "\t=x", "\r=x"]) {
      expect(csvCell(bad).replace(/^"/, "").startsWith("'"), JSON.stringify(bad)).toBe(true);
    }
    expect(csvCell("일반")).toBe("일반");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
  });

  it("머리글과 행을 BOM 포함 CSV로 만든다", () => {
    expect(
      toCsv(
        ["a", "b"],
        [
          ["1", "=2"],
          ["x,y", ""],
        ],
      ),
    ).toBe('﻿a,b\r\n1,\'=2\r\n"x,y",\r\n');
  });
});

describe("ZIP 항목 이름", () => {
  it("경로 구분자·상위 이동·제어 문자를 제거한다", () => {
    expect(safeEntryName("영수증.pdf")).toBe("영수증.pdf");
    expect(safeEntryName("../../etc/passwd")).toBe(".._.._etc_passwd");
    expect(safeEntryName("a\\b/c")).toBe("a_b_c");
    expect(safeEntryName("x\u0000y\nz")).toBe("x_y_z");
    expect(safeEntryName("..")).toBe("_");
    expect(safeEntryName("")).toBe("_");
  });

  it("너무 긴 이름은 확장자를 살려 자른다", () => {
    const name = `${"가".repeat(300)}.xlsx`;
    const out = safeEntryName(name);
    expect(out.endsWith(".xlsx")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(120);
  });
});

describe("내보내기 manifest", () => {
  it("파일을 경로순으로 정렬하고 같은 입력이면 같은 JSON이다", () => {
    const input = {
      account: { id: "a1", name: "회사" },
      generatedAt: "2026-10-05T00:00:00.000Z",
      files: [
        { path: "docs/b.json", size: 2, sha256: "bb" },
        { path: "docs/a.json", size: 1, sha256: "aa" },
      ],
      counts: { documents: 2, excludedDocuments: 1 },
    };
    const a = buildExportManifest(input);
    const b = buildExportManifest({ ...input, files: [...input.files].reverse() });
    expect(a).toBe(b);
    const parsed = JSON.parse(a);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.files.map((f: { path: string }) => f.path)).toEqual([
      "docs/a.json",
      "docs/b.json",
    ]);
    expect(parsed.counts.excludedDocuments).toBe(1);
    expect(a.endsWith("\n")).toBe(true);
  });
});
