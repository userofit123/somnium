// Password rules (PLAN.md §4.2): at least 10 characters and not one of the 10,000 most common passwords.
// Checked on the device, where the password is typed: the server never sees it (it only gets authKey, kdf.ts),
// so the server checks nothing but the authKey's shape. The list is loaded on first use (it is ~80 KB).
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;

let list: Promise<Set<string>> | undefined;
const commonPasswords = () => (list ??= import("./common-passwords").then((m) => new Set(m.COMMON_PASSWORDS.map((p) => p.toLowerCase()))).catch((e) => { list = undefined; throw e; }));

/** Why a password cannot be used, in plain words, or null when it is fine. */
export async function passwordProblem(password: string): Promise<string | null> {
  if (typeof password !== "string" || password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters`;
  if ((await commonPasswords()).has(password.trim().toLowerCase())) return "That password is on the list of the most common ones - choose another";
  return null;
}
