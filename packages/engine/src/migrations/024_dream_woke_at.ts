// LDJ-177: when you woke from a dream, stamped by the capture opened in the night (or by the WBTB alarm's), so the
// night page can place it and Insights can say which hours after bedtime your dreams come from (REM comes every
// ~90 min and runs longer late in the night, RESEARCH.md C31, C1). A moment like a night's bedtime and wake time,
// plain as they are: it says when, never what. Null on dreams written up later, which have no such moment.
export default /* sql */ `
ALTER TABLE dreams ADD COLUMN IF NOT EXISTS woke_at timestamptz;
`;
