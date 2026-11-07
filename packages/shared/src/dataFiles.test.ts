import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, csvCell, dreamMarkdownFiles, exportCsv, journalMarkdown, makeZip, parseCsv, toCsv } from "./dataFiles";

const hasUnzip = (() => { try { execFileSync("unzip", ["-v"], { stdio: "ignore" }); return true; } catch { return false; } })();

describe("csv", () => {
  it("escapes commas, quotes, line breaks and edge spaces", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('she said "hi"')).toBe('"she said ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell(" pad")).toBe('" pad"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(true)).toBe("true");
    expect(csvCell(["mild", "wbtb"])).toBe("mild; wbtb");
  });
  it("keeps spreadsheet formulas from running, but not numbers", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("-2")).toBe("-2");
    expect(csvCell(-2)).toBe("-2");
  });
  it("reads back what it writes", () => {
    const rows = [["date", "text"], ["2026-11-01", 'a "quoted", multi\nline text'], ["2026-11-02", ""]];
    expect(parseCsv(toCsv(rows[0]!, rows.slice(1)))).toEqual(rows.map((r) => r.map(String)).slice(0, 2).concat([["2026-11-02", ""]]));
  });
  it("finds a semicolon delimiter and drops a BOM", () => {
    expect(parseCsv("﻿Datum;Traum\r\n07.11.2026;Fliegen\r\n")).toEqual([["Datum", "Traum"], ["07.11.2026", "Fliegen"]]);
  });
});

const tables = {
  nights: [{ id: "n1", date: "2026-11-01", sleep_quality: 4, notes: "secret note", techniques_done: ["mild"] }, { id: "n2", date: "2026-11-02" }],
  dreams: [
    { id: "d2", night_id: "n1", position: 1, title: "Second", text: "B", lucid: false, lucidity_level: 0 },
    { id: "d1", night_id: "n1", position: 0, title: "First, with comma", text: "A", lucid: true, lucidity_level: 2 },
    { id: "d3", night_id: "n2", position: 0, title: "Gone", text: "C", deleted_at: "2026-11-03" },
  ],
  elements: [{ id: "e1", kind: "place", name: "Harbour", is_dream_sign: true }],
  dream_elements: [{ id: "l1", dream_id: "d1", element_id: "e1" }],
  reality_checks: [{ id: "r1", at: "2026-11-01T10:00:00Z", kind: "nose", outcome: "awake", note: "bus" }],
};

describe("exports", () => {
  it("CSV leaves the sealed fields out unless asked", () => {
    const without = exportCsv(tables, "dreams", false);
    expect(without).not.toContain("First");
    expect(without.split("\r\n")[0]).toMatch(/^date,id,position,lucid/);
    expect(without.split("\r\n")).toHaveLength(4); // header, two live dreams, the final empty line
    const withText = exportCsv(tables, "dreams", true);
    expect(withText).toContain('"First, with comma"');
    expect(exportCsv(tables, "nights", false)).not.toContain("secret");
    expect(exportCsv(tables, "nights", true)).toContain("secret note");
    expect(exportCsv(tables, "reality_checks", false)).not.toContain("bus");
  });
  it("Markdown: one file per live dream, in order, names unique", () => {
    const files = dreamMarkdownFiles(tables);
    expect(files.map((f) => f.filename)).toEqual(["dream-2026-11-01.md", "dream-2026-11-01-2.md"]);
    expect(files[0]!.markdown).toContain("Harbour (Place) - dream sign");
    expect(journalMarkdown(tables)).toContain("\n---\n");
  });
});

describe("zip", () => {
  it("crc32 matches the standard check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
  it("writes an archive that unzip accepts", () => {
    const zip = makeZip([{ name: "dream-2026-11-01.md", data: "# Flying\n" }, { name: "ümlaut.csv", data: "a,b\r\n" }, { name: "empty.txt", data: "" }]);
    expect(new DataView(zip.buffer).getUint32(0, true)).toBe(0x04034b50);
    if (!hasUnzip) return;
    const dir = mkdtempSync(join(tmpdir(), "zip-")), path = join(dir, "t.zip");
    writeFileSync(path, zip);
    const out = execFileSync("unzip", ["-t", path]).toString();
    expect(out).toMatch(/No errors detected/);
    expect(execFileSync("unzip", ["-p", path, "dream-2026-11-01.md"]).toString()).toBe("# Flying\n");
  });
});
