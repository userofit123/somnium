// LDJ-65: a bad dream (upsetting, but you slept on) apart from a nightmare (upsetting enough to wake you), the line
// Zadra and Donderi (2000) drew: nightmare frequency goes with poorer well-being more than bad-dream frequency
// (RESEARCH.md C18, C19). Plain like nightmare, recurring and the other dream marks: a yes/no the server counts for
// Insights over /dream-facts without a key, and says nothing a nightmare mark doesn't already. A dream is one or the
// other, never both: the engine keeps that (modules/journal.ts), not a CHECK, so a whole row from a device on an older
// version (no bad_dream in it) can never make sync fail.
export default /* sql */ `
ALTER TABLE dreams ADD COLUMN IF NOT EXISTS bad_dream boolean NOT NULL DEFAULT false;
`;
