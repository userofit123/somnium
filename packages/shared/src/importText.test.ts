import { describe, it, expect } from "vitest";
import { entriesFromCsv, guessCsvMapping, parseLooseDate, splitJournalText } from "./importText";

describe("splitting a journal at its date headings", () => {
  it("splits Markdown headings in several date styles", () => {
    const text = [
      "My dream journal", "",
      "# 2026-11-01", "Flying over the harbour.", "",
      "## Monday, 2 November 2026 - Exam", "Back at school.", "Second line.", "",
      "### November 3, 2026", "#### The lake", "Swimming. LUCID", "",
      "**04.11.2026**", "Short one.",
    ].join("\n");
    const { entries, undated } = splitJournalText(text);
    expect(entries.map((e) => e.date)).toEqual(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"]);
    expect(entries[0]).toMatchObject({ title: "", text: "Flying over the harbour." });
    expect(entries[1]).toMatchObject({ title: "Exam", text: "Back at school.\nSecond line." });
    expect(entries[2]).toMatchObject({ title: "The lake", text: "Swimming. LUCID" });
    expect(entries[3]!.text).toBe("Short one.");
    expect(undated).toBe("My dream journal".length);
  });
  it("doesn't split at a sentence that mentions a date", () => {
    const { entries } = splitJournalText("# 2026-11-01\nI dreamt it was 5 May 2027 and we met.\n");
    expect(entries).toHaveLength(1);
    expect(entries[0]!.text).toContain("5 May 2027");
  });
  it("takes one note per dream dated by front matter or file name", () => {
    expect(splitJournalText("---\ndate: 2026-10-30\ntags: [lucid]\n---\n# Night flight\nUp and away.", "x.md").entries[0])
      .toMatchObject({ date: "2026-10-30", title: "Night flight", text: "Up and away." });
    expect(splitJournalText("Just the dream.", "2026-10-29 dream.md").entries[0]).toMatchObject({ date: "2026-10-29", text: "Just the dream." });
    expect(splitJournalText("No date anywhere.", "notes.txt").entries).toEqual([]);
  });
  it("refuses impossible dates", () => {
    expect(parseLooseDate("2026-02-30")).toBeNull();
    expect(parseLooseDate("11/07/2026")).toBe("2026-11-07");
  });
});

describe("CSV rows", () => {
  it("guesses the columns and maps rows to entries", () => {
    const rows = [["Date", "Title", "Dream", "Lucid?"], ["2026-11-01", "Fly", "Over the sea", "yes"], ["", "x", "no date", ""], ["2026-11-02", "", "Walk", "no"]];
    const map = guessCsvMapping(rows[0]!);
    expect(map).toEqual({ date: 0, title: 1, text: 2, lucid: 3 });
    const { entries, skipped } = entriesFromCsv(rows, map);
    expect(skipped).toBe(1);
    expect(entries).toEqual([{ date: "2026-11-01", title: "Fly", text: "Over the sea", lucid: true }, { date: "2026-11-02", title: "", text: "Walk", lucid: undefined }]);
  });
});
