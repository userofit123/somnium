import { describe, expect, it } from "vitest";
import { buildGenerateBody, checkModelAddress, cleanModelSetting, parseElementLines, summaryNote } from "./localModel";

describe("checkModelAddress", () => {
  it("accepts this computer and the private LAN, over http or https", () => {
    expect(checkModelAddress("http://192.168.1.5:11434")).toMatchObject({ ok: true, origin: "http://192.168.1.5:11434", insecure: true });
    expect(checkModelAddress("https://10.0.0.7:8443/x?y")).toMatchObject({ ok: true, origin: "https://10.0.0.7:8443", insecure: false });
    expect(checkModelAddress("192.168.1.5")).toMatchObject({ ok: true, origin: "http://192.168.1.5:11434" });
    expect(checkModelAddress("localhost")).toMatchObject({ ok: true, origin: "http://localhost:11434" });
    for (const a of ["http://127.0.0.1:11434", "http://[::1]:11434", "http://172.16.0.1", "http://172.31.255.1", "http://169.254.1.1", "https://[fd12:3456::1]"]) expect(checkModelAddress(a).ok, a).toBe(true);
    expect(checkModelAddress("http://localhost:11434")).not.toHaveProperty("warning");
    expect(checkModelAddress("http://192.168.1.5:11434")).toHaveProperty("warning");
  });
  it("never a public host, a name that could resolve to one, or another scheme", () => {
    for (const a of ["https://example.com", "https://ollama.home/x", "http://example.com:11434", "https://8.8.8.8", "http://172.32.0.1", "http://192.169.0.1",
      "http://localhost.example.com", "https://[2001:db8::1]", "", "ftp://192.168.1.5", "http://u:p@192.168.1.5", "file:///etc/passwd"]) expect(checkModelAddress(a).ok, a).toBe(false);
  });
});

describe("cleanModelSetting", () => {
  it("keeps only a valid address's origin, the name and the tick", () => {
    expect(cleanModelSetting({ url: "192.168.1.5", model: " llama3 ", ack: true, x: 1 })).toEqual({ url: "http://192.168.1.5:11434", model: "llama3", ack: true });
    expect(cleanModelSetting({ url: "https://example.com", model: "m", ack: true })).toBeNull();
    expect(cleanModelSetting({ url: "", model: "", ack: true })).toBeNull();
    expect(cleanModelSetting({ url: "http://10.0.0.2:11434", model: "m", ack: "yes" })).toMatchObject({ ack: false });
    expect(cleanModelSetting(null)).toBeNull();
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
