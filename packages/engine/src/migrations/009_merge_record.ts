// LDJ-52, second round. A night's absorbed was a one-shot boolean on the merged night; it becomes a sealed record on
// the survivor (fingerprints of the texts it took in, sync/core.ts mergeNightFields), so it travels with the text it
// describes. The boolean is dropped: 008 had only run on development databases, and a boolean that said "done"
// could keep a lost join from ever being made again. Plus an index for following merged_into.
export default /* sql */ `
ALTER TABLE nights DROP COLUMN IF EXISTS absorbed;
ALTER TABLE nights ADD COLUMN absorbed text;
CREATE INDEX IF NOT EXISTS nights_merged_into ON nights (merged_into) WHERE merged_into IS NOT NULL;
`;
