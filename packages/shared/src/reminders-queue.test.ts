import { describe, expect, it } from "vitest";
import { queuedChecksOf, splitQueuedChecks, type QueuedCheck } from "./reminders";

const q = (id: string, account?: string, user?: string): QueuedCheck => ({ id, at: 1, check: "hands", outcome: "awake", account, user });

describe("checks queued from a notification", () => {
  const items = [q("a1", "acc-a", "ann"), q("b1", "acc-b", "bob"), q("a2", "acc-a", "ann"), q("old"), q("a-other-user", "acc-a", "carl")];
  it("posts only the open account's, for the person signed in on it", () => {
    const s = splitQueuedChecks(items, "acc-a", "ann");
    expect(s.mine.map((x) => x.id)).toEqual(["a1", "a2"]);
    expect(s.others.map((x) => x.id)).toEqual(["b1", "a-other-user"]);
    expect(s.stale.map((x) => x.id)).toEqual(["old"]);
  });
  it("leaves another account's for it", () => {
    expect(splitQueuedChecks(items, "acc-b", "bob").mine.map((x) => x.id)).toEqual(["b1"]);
  });
  it("posts nothing while the account or the person is unknown", () => {
    expect(splitQueuedChecks(items, "acc-a", null).mine).toEqual([]);
    expect(splitQueuedChecks(items, null, "ann").mine).toEqual([]);
  });
  it("finds a removed account's checks", () => {
    expect(queuedChecksOf(items, "acc-a").map((x) => x.id)).toEqual(["a1", "a2", "a-other-user"]);
  });
});

import * as lex from "@somnium/knowledge/lexicons";
import { CHECK_IDS, HABIT_LABELS, storableSchedule } from "./reminders";

describe("what a reminders row may hold (the table is plain)", () => {
  it("knows the same checks as the catalog", () => {
    expect([...CHECK_IDS].sort()).toEqual(lex.checks.map((c) => c.id).sort());
  });
  it("keeps times, numbers and fixed values, and drops free text", () => {
    const s = storableSchedule({
      perDay: 8, from: "09:00", to: "nope", quiet: { on: true, from: "22:00", to: "x", note: "secret" },
      habits: [{ at: "08:00", label: HABIT_LABELS[0] }, { at: "09:00", label: "my secret habit" }],
      checks: ["nose-pinch", "I dreamt of Ann"], technique: "free text", note: "anything", pausedOn: null,
    });
    expect(s).toEqual({ perDay: 8, from: "09:00", quiet: { on: true, from: "22:00" }, habits: [{ at: "08:00", label: HABIT_LABELS[0] }], checks: ["nose-pinch"], pausedOn: null });
    expect(JSON.stringify(s)).not.toMatch(/secret|Ann|anything|free text/);
  });
});
