import { describe, expect, it } from "vitest";
import { buildGenerateBody, checkModelAddress, parseElementLines, summaryNote } from "./localModel";

describe("checkModelAddress", () => {
  it("follows the server address rules", () => {
    expect(checkModelAddress("http://192.168.1.5:11434")).toMatchObject({ ok: true, origin: "http://192.168.1.5:11434", insecure: true });
    expect(checkModelAddress("https://ollama.home/x")).toMatchObject({ ok: true, origin: "https://ollama.home" });
    for (const a of ["http://example.com:11434", "http://8.8.8.8", "", "ftp://x", "http://u:p@192.168.1.5"]) expect(checkModelAddress(a).ok, a).toBe(false);
  });
});

describe("buildGenerateBody", () => {
  it("holds only the instruction, the model and the dream text, not streaming", () => {
    const b = buildGenerateBody("summary", "llama3", "  I flew over a lake.  ");
    expect(b.stream).toBe(false);
    expect(b.model).toBe("llama3");
    expect(Object.keys(b).sort()).toEqual(["model", "prompt", "stream"]);
    expect(b.prompt).toContain("I flew over a lake.");
    expect(b.prompt).toMatch(/^Summarise/);
    expect(buildGenerateBody("elements", "m", "x").prompt).toMatch(/one per line/);
  });
});

describe("parseElementLines", () => {
  it("reads kind: name lines, with bullets, and drops the rest", () => {
    const r = parseElementLines("Here you go:\n- character: A tall woman\n2. Place: the lake.\n* **feeling**: Fear\nobject: the lake\nplace: The Lake\nnonsense line\ndream_sign: flying\nthing:   ");
    expect(r).toEqual([{ kind: "character", name: "A tall woman" }, { kind: "place", name: "the lake" }, { kind: "emotion", name: "Fear" }, { kind: "object", name: "the lake" }]);
  });
  it("caps the list", () => {
    expect(parseElementLines(Array.from({ length: 30 }, (_, i) => `object: thing ${i}`).join("\n"))).toHaveLength(12);
  });
});

describe("summaryNote", () => {
  it("adds one marked line to what is there", () => {
    expect(summaryNote(null, "A flight.\n")).toBe("Summary (my model): A flight.");
    expect(summaryNote("Slept badly", "A flight.")).toBe("Slept badly\nSummary (my model): A flight.");
  });
});
