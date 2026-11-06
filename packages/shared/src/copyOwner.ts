// Whose copy of the journal a tab may work on. A device's copy is plaintext and holds that person's unsent changes, so
// it must never serve, or be sent under, anyone else's session. Kept apart from the browser so it can be tested.

export interface CopyDecision {
  /** Close the open copy and go back to the server: it isn't this person's. */
  stop: boolean;
  /** Open this person's own copy (a no-op when it is already open). */
  start: boolean;
}

/** openFor: whose copy is open in this tab. signedIn: who the session belongs to now. */
export function copyDecision(openFor: string | null, signedIn: string | null): CopyDecision {
  return { stop: openFor !== null && openFor !== signedIn, start: signedIn !== null };
}

/**
 * What another person left behind on this device, among stored names of the form prefix + user id. When someone's
 * session ends without signing out (it expired, or was ended elsewhere) their copy waits for them to come back; once
 * someone else signs in here, it goes unless it holds unsent changes (leftWithNothingUnsent).
 * keep: people with an account saved in this app (Android: several accounts on one server). Theirs isn't left behind,
 * it waits for a switch back, which has to work offline.
 */
export const leftByOthers = (names: readonly string[], prefix: string, userId: string, keep: readonly string[] = []): string[] =>
  names.filter((n) => n.startsWith(prefix) && n !== prefix + userId && !keep.some((k) => k && n === prefix + k));

/**
 * Sent with every request to /sync/*: whose copy this request comes from. The server compares it with who the session
 * belongs to and answers 409 on any difference (or none sent), so one person's rows can't reach another's account.
 */
export const COPY_OWNER_HEADER = "x-somnium-copy-user";
/** The status of that refusal. */
export const COPY_OWNER_REFUSED = 409;

// What opens a person's journal on this device (the bundle for the password, the wrapped key for the device's own
// verification) is theirs alone. Opening one under someone else's session would seal that person's rows under this key.
// "#" can't appear in a server's address, so one address that starts like another never matches it.

/** Where a person's record of this kind is kept. */
export const unlockRecordName = (kind: string, place: string, userId: string): string => `${kind}:${place}#${userId}`;

/** The record, only if it says it belongs to this person. One with no owner belongs to nobody. */
export const ownRecord = <T extends { owner?: string }>(record: T | null | undefined, userId: string | null): T | null =>
  record && userId && record.owner === userId ? record : null;

/** Among stored names: this server's records of this kind that aren't this person's, older ones without an owner included. */
export const unlockRecordsToForget = (names: readonly string[], kind: string, place: string, userId: string, keep: readonly string[] = []): string[] =>
  names.filter((n) => n === `${kind}:${place}` || (n.startsWith(`${kind}:${place}#`) && n !== unlockRecordName(kind, place, userId)
    && !keep.some((k) => k && n === unlockRecordName(kind, place, k))));

/**
 * Among copies other people left here, those that may go. A copy holding changes the server hasn't got waits for its
 * owner's next sign-in, whoever uses the device meanwhile. unsentOf gives what the device noted for a copy: "0" when
 * nothing is waiting. A copy with no note could hold anything, so it stays.
 */
export const leftWithNothingUnsent = (names: readonly string[], unsentOf: (name: string) => string): string[] =>
  names.filter((n) => unsentOf(n) === "0");
