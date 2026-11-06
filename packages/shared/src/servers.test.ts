import { describe, expect, it } from "vitest";
import { checkServerAddress, isLocalHost, normaliseStore, orderAccounts, removePlan, syncLabel, syncStateOf, type AccountEntry } from "./servers";

describe("checkServerAddress", () => {
  it("adds https and keeps only the origin", () => {
    expect(checkServerAddress("Somnium.Example.com/x/")).toEqual({ ok: true, origin: "https://somnium.example.com", insecure: false });
    expect(checkServerAddress(" https://somnium.home:8443/a?b ")).toMatchObject({ ok: true, origin: "https://somnium.home:8443" });
  });
  it("allows http only on this computer and private networks, with a warning", () => {
    for (const a of ["http://localhost:3000", "http://127.0.0.1", "http://192.168.1.5:8080", "http://10.0.0.2", "http://172.20.1.1", "http://[::1]:80", "http://nas.localhost"]) {
      const r = checkServerAddress(a);
      expect(r.ok, a).toBe(true);
      if (r.ok) { expect(r.insecure).toBe(true); expect(r.warning).toMatch(/http/); }
    }
    for (const a of ["http://example.com", "http://172.32.0.1", "http://8.8.8.8", "http://192.169.0.1", "http://300.1.1.1"]) expect(checkServerAddress(a).ok, a).toBe(false);
  });
  it("refuses what isn't a web address", () => {
    expect(checkServerAddress("")).toMatchObject({ ok: false });
    expect(checkServerAddress("ftp://x.com")).toMatchObject({ ok: false });
    expect(checkServerAddress("https://user:pw@x.com")).toMatchObject({ ok: false });
    expect(checkServerAddress("http://")).toMatchObject({ ok: false });
  });
  it("knows the private ranges", () => {
    expect(isLocalHost("172.16.0.1")).toBe(true);
    expect(isLocalHost("172.31.255.255")).toBe(true);
    expect(isLocalHost("fd12::1")).toBe(true);
    expect(isLocalHost("somnium.local")).toBe(false);
  });
});

const acc = (o: Partial<AccountEntry> & { id: string }): AccountEntry => ({ kind: "server", name: o.id, ...o });

describe("orderAccounts", () => {
  it("puts this device first, then servers by name, accounts by name", () => {
    const o = orderAccounts({
      active: null,
      servers: [{ id: "s2", name: "work", url: "https://b" }, { id: "s1", name: "Home", url: "https://a" }],
      list: [acc({ id: "x", serverId: "s2" }), acc({ id: "z", kind: "local", name: "zed" }), acc({ id: "b", serverId: "s1", user: "bob" }), acc({ id: "a", serverId: "s1", user: "alice" }), acc({ id: "y", kind: "local", name: "Ann" })],
    });
    expect(o.device.map((a) => a.id)).toEqual(["y", "z"]);
    expect(o.servers.map((g) => g.server.name)).toEqual(["Home", "work"]);
    expect(o.servers[0]!.accounts.map((a) => a.id)).toEqual(["a", "b"]);
  });
  it("keeps a server with no account, and an account whose server is missing", () => {
    const o = orderAccounts({ active: null, servers: [{ id: "s1", name: "Empty", url: "https://a" }], list: [acc({ id: "q", url: "https://q.example" })] });
    expect(o.servers.map((g) => [g.server.name, g.accounts.length])).toEqual([["Empty", 0], ["q.example", 1]]);
  });
});

describe("normaliseStore", () => {
  it("turns old server accounts into saved servers named as they were", () => {
    let n = 0;
    const s = normaliseStore({ list: [{ id: "a", kind: "server", name: "Home", url: "https://h" }, { id: "b", kind: "server", name: "Other", url: "https://h" }, { id: "c", kind: "local", name: "Me" }], active: "a" }, () => "s" + ++n);
    expect(s.servers).toEqual([{ id: "s1", name: "Home", url: "https://h" }]);
    expect(s.list.map((a) => a.serverId)).toEqual(["s1", "s1", undefined]);
    expect(s.active).toBe("a");
  });
  it("survives nothing at all and drops an active id that isn't there", () => {
    expect(normaliseStore(null, () => "x")).toEqual({ list: [], active: null, servers: [] });
    expect(normaliseStore({ list: [], active: "gone" }, () => "x").active).toBeNull();
  });
});

describe("removePlan", () => {
  it("names what a local account loses", () => {
    const p = removePlan({ what: "account", name: "Me", kind: "local", pending: 0, device: "phone" });
    expect(p.text).toMatch(/deleted for good/);
    expect(p.unsent).toBe(0);
  });
  it("guards unsent changes on a server account or a server", () => {
    const a = removePlan({ what: "account", name: "bob", kind: "server", pending: 3, device: "computer" });
    expect(a.unsent).toBe(3);
    expect(a.text).toMatch(/3 changes that haven't reached the server yet are lost/);
    const s = removePlan({ what: "server", name: "Home", kind: "server", pending: 0, accounts: 2, device: "phone" });
    expect(s.unsent).toBe(0);
    expect(s.text).toMatch(/the 2 accounts/);
    expect(s.text).toMatch(/stays there/);
  });
});

describe("sync state", () => {
  it("labels each state plainly", () => {
    expect(syncLabel({ state: "synced", pending: 0, at: 0 }, "server")).toBe("Synced");
    expect(syncLabel({ state: "waiting", pending: 2, at: 0 }, "server")).toBe("Waiting · 2");
    expect(syncLabel({ state: "offline", pending: 0, at: 0 }, "server")).toBe("Offline");
    expect(syncLabel({ state: "locked", pending: 0, at: 0 }, "server")).toBe("Not syncing · locked");
    expect(syncLabel(undefined, "local")).toBe("On this device");
  });
  it("derives the open account's state", () => {
    const base = { signedIn: true, copyOn: true, online: true, sealed: true, pending: 0 };
    expect(syncStateOf(base)).toBe("synced");
    expect(syncStateOf({ ...base, pending: 1 })).toBe("waiting");
    expect(syncStateOf({ ...base, online: false })).toBe("offline");
    expect(syncStateOf({ ...base, sealed: false })).toBe("locked");
    expect(syncStateOf({ ...base, signedIn: false })).toBe("signedOut");
  });
});
