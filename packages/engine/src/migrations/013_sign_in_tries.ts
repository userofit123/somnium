// LDJ-59: sign-in tries kept in the database instead of the server's memory, so a restart (or a crash on purpose)
// does not hand out a fresh set of guesses. One row per try and key ("ip:<address>" or "u:<name>"); a right answer
// deletes its rows again, rows older than the window are pruned on every try (apps/server/src/auth.ts). Like the
// other sign-in tables it is not granted to somnium_app at all and has no row-level security: only the server's
// own code (the admin connection) reads it.
export default /* sql */ `
CREATE TABLE sign_in_tries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key text NOT NULL,
  at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX sign_in_tries_key ON sign_in_tries (key, at);
CREATE INDEX sign_in_tries_at ON sign_in_tries (at);
`;
