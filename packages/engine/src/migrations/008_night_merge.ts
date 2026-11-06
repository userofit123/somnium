// Two devices that log the same night offline (LDJ-52): the second night to reach a place where the first already is
// is merged into it rather than refused (sync/core.ts, settleNight). Both plain: the server has to set merged_into
// (it decides which night survives) and every device has to read both.
//   merged_into: the night this one was merged into (it is soft-deleted; its dreams now hang off that night).
//   absorbed: replaced in 009 by a sealed record on the survivor (see there).
export default /* sql */ `
ALTER TABLE nights ADD COLUMN IF NOT EXISTS merged_into uuid;
ALTER TABLE nights ADD COLUMN IF NOT EXISTS absorbed boolean NOT NULL DEFAULT false;
`;
