// Element suggestions the person dismissed for a dream (PLAN.md §7.1, LDJ-18): a sealed JSON list of suggestion keys
// kept with the dream, so a dismissed suggestion stays gone on every device. Sealed: the keys are element names.
export default /* sql */ `
ALTER TABLE dreams ADD COLUMN IF NOT EXISTS dismissed text;
`;
