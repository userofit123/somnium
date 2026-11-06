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
 * someone else signs in here, it goes.
 */
export const leftByOthers = (names: readonly string[], prefix: string, userId: string): string[] =>
  names.filter((n) => n.startsWith(prefix) && n !== prefix + userId);
