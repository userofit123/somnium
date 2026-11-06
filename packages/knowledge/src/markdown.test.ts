import { describe, expect, it } from "vitest";
import { parseMarkdown, parseInline, safeHref, inlineText } from "./markdown";
import { citationsIn } from "./content";

describe("markdown", () => {
  it("reads headings, paragraphs and wrapped lines", () => {
    const b = parseMarkdown("## Title\n\nOne line\nwrapped.\n\nSecond.");
    expect(b.map((x) => x.t)).toEqual(["heading", "p", "p"]);
    expect(inlineText((b[1] as any).children)).toBe("One line wrapped.");
  });
  it("reads bullet and numbered lists", () => {
    const b = parseMarkdown("- a\n- b\n\n3. c\n4. d");
    expect(b[0]).toMatchObject({ t: "ul" });
    expect((b[0] as any).items).toHaveLength(2);
    expect(b[1]).toMatchObject({ t: "ol", start: 3 });
  });
  it("reads blockquotes and tables", () => {
    const b = parseMarkdown("> quoted [B1]\n\n| A | B |\n|---|--:|\n| 1 | 2 |\n| 3 | 4 |");
    expect(b[0]).toMatchObject({ t: "quote" });
    const t = b[1] as any;
    expect(t.t).toBe("table");
    expect(t.rows).toHaveLength(2);
    expect(t.align).toEqual([null, "right"]);
  });
  it("reads bold, italic, code and links", () => {
    const n = parseInline("a **b** *c* `d` [e](https://x.org)");
    expect(n.map((x) => x.t)).toEqual(["text", "strong", "text", "em", "text", "code", "text", "link"]);
  });
  it("turns citations into marks, single and grouped", () => {
    expect(parseInline("x [B40] y [A3, A4]").filter((x) => x.t === "cite")).toEqual([
      { t: "cite", ids: ["B40"] }, { t: "cite", ids: ["A3", "A4"] },
    ]);
    expect(citationsIn("x [B40] y [A3, A4] [B40]")).toEqual(["B40", "A3", "A4"]);
  });
  it("never produces HTML: markup stays as text", () => {
    const b = parseMarkdown("<script>alert(1)</script> and <b>bold</b>\n\n<img src=x onerror=alert(1)>");
    const all = JSON.stringify(b);
    expect(all).toContain("<script>");
    // the only node kinds are the plain ones; there is no raw html node
    expect(b.every((x) => x.t === "p")).toBe(true);
    expect(JSON.stringify(parseInline("**<i>x</i>**"))).toContain('"text":"<i>x</i>"');
  });
  it("drops unsafe link targets but keeps the words", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,x")).toBeNull();
    expect(safeHref("//evil.example")).toBeNull();
    // browsers treat a backslash as "/" in a URL, so "/\host" is "//host": another site; tabs inside are dropped
    expect(safeHref("/\\evil.example")).toBeNull();
    expect(safeHref(" /\\evil.example/x")).toBeNull();
    expect(safeHref("/\t/evil.example")).toBeNull();
    expect(safeHref("/learn/mild")).toBe("/learn/mild");
    expect(safeHref("https://example.org")).toBe("https://example.org");
    const n = parseInline("[click](javascript:alert)");
    expect(n).toEqual([{ t: "text", text: "click" }]);
  });
  it("does not treat snake_case or a lone star as emphasis", () => {
    expect(inlineText(parseInline("a_b_c and 2 * 3"))).toBe("a_b_c and 2 * 3");
  });
});
