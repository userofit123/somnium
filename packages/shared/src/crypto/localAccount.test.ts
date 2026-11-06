// A local account's keys (LDJ-53): made on the device, opened by the password or the recovery key, nothing else.
import { describe, it, expect } from "vitest";
import { SealError, addLocalRecoveryKey, createLocalKeys, localKeysFrom, localRecoveryFrom, openLocalWithPassword, recoverLocal, rewrapLocalPassword, sealColumn, unsealColumn } from "./index";

const PW = "a long passphrase 1", NEW_PW = "another long one 2";

describe("local account keys", () => {
  it("makes keys whose data key only the password opens", async () => {
    const { keys, dataKey } = await createLocalKeys(PW);
    expect(keys.recoverySalt).toBeNull();
    expect(JSON.stringify(keys)).not.toContain(PW);
    const opened = await openLocalWithPassword(keys, PW);
    expect(opened).toEqual(dataKey);
    await expect(openLocalWithPassword(keys, PW + "x")).rejects.toBeInstanceOf(SealError);
    // what was sealed with the key opens with the one the password gives back
    const sealed = await sealColumn("I was flying", dataKey, "dreams", "text", "r1");
    expect(await unsealColumn(sealed, opened, "dreams", "text", "r1")).toBe("I was flying");
  });

  it("survives a round trip through storage and refuses a damaged record", async () => {
    const { keys, dataKey } = await createLocalKeys(PW);
    const withKey = (await addLocalRecoveryKey(keys, dataKey)).keys;
    expect(localKeysFrom(JSON.parse(JSON.stringify(withKey)))).toEqual(withKey);
    expect(localKeysFrom(null)).toBeNull();
    expect(localKeysFrom({ salt: keys.salt })).toBeNull();
    // half a recovery key is no recovery key
    expect(localKeysFrom({ ...withKey, wrappedByRecovery: null })).toBeNull();
  });

  it("changes the password without changing the data key", async () => {
    const { keys, dataKey } = await createLocalKeys(PW);
    const next = await rewrapLocalPassword(keys, dataKey, NEW_PW);
    expect(await openLocalWithPassword(next, NEW_PW)).toEqual(dataKey);
    await expect(openLocalWithPassword(next, PW)).rejects.toBeInstanceOf(SealError);
  });

  it("recovers with the recovery key: a new password, a new recovery key, the old key used up", async () => {
    const { keys, dataKey } = await createLocalKeys(PW);
    const made = await addLocalRecoveryKey(keys, dataKey);
    expect(made.recoveryKey).toMatch(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){4}$/);
    const back = await recoverLocal(made.keys, made.recoveryKey.toLowerCase().replace(/-/g, " "), NEW_PW);
    expect(back.dataKey).toEqual(dataKey);
    expect(back.recoveryKey).not.toBe(made.recoveryKey);
    expect(await openLocalWithPassword(back.keys, NEW_PW)).toEqual(dataKey);
    await expect(openLocalWithPassword(back.keys, PW)).rejects.toBeInstanceOf(SealError);
    await expect(recoverLocal(back.keys, made.recoveryKey, "third password 333")).rejects.toBeInstanceOf(SealError);
    expect((await recoverLocal(back.keys, back.recoveryKey, "third password 333")).dataKey).toEqual(dataKey);
  });

  it("refuses a wrong recovery key, and recovery when none was made", async () => {
    const { keys, dataKey } = await createLocalKeys(PW);
    await expect(recoverLocal(keys, "ABCD-EFGH-JKMN-PQRS-TUVW", NEW_PW)).rejects.toBeInstanceOf(SealError);
    const made = await addLocalRecoveryKey(keys, dataKey);
    await expect(recoverLocal(made.keys, "ABCD-EFGH-JKMN-PQRS-TUVW", NEW_PW)).rejects.toThrow("not right");
    // nothing changed: the password still opens it
    expect(await openLocalWithPassword(made.keys, PW)).toEqual(dataKey);
  });

  it("recovers from a damaged record with its recovery key part, and has nothing to offer without one", async () => {
    const { keys, dataKey } = await createLocalKeys(PW);
    const made = await addLocalRecoveryKey(keys, dataKey);
    const damaged = { ...made.keys, salt: 42, wrappedByPassword: undefined };
    expect(localKeysFrom(damaged)).toBeNull();
    const part = localRecoveryFrom(damaged)!;
    expect(part).not.toBeNull();
    const back = await recoverLocal(part, made.recoveryKey, NEW_PW);
    expect(back.dataKey).toEqual(dataKey);
    expect(localKeysFrom(back.keys)).not.toBeNull();
    expect(await openLocalWithPassword(back.keys, NEW_PW)).toEqual(dataKey);
    expect(localRecoveryFrom({ ...keys, salt: 42 })).toBeNull();
    expect(localRecoveryFrom("nonsense")).toBeNull();
  });
});
