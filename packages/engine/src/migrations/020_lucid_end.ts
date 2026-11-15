// LDJ-78: how a lucid dream ended (woke up, lost lucidity, faded, still lucid at waking), beside how it started
// (became_lucid_how) and how long it lasted (duration_est). A plain value from a fixed list (packages/shared/src/types.ts
// LUCID_ENDS), never text, so it is not sealed; the one line in the person's words stays in lucid_trigger (sealed.ts).
// Its own column, not a new wake_method: how you woke (alarm, naturally, WBTB) is a different question.
export default /* sql */ `
ALTER TABLE dreams ADD COLUMN IF NOT EXISTS lucid_end text CHECK (lucid_end IN ('woke','lost','faded','still_going'));
`;
