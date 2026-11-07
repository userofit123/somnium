// LDJ-49: which WBTB mode a night used (the planner's Short, Long and LaBerge nap, or a CAT morning), so "What works
// for you" can compare them. A plain value from a fixed list (packages/shared/src/guided.ts WBTB_MODE_LOG), never
// text, so it is not sealed and the sync carries it like wbtb_minutes_awake.
export default /* sql */ `
ALTER TABLE nights ADD COLUMN wbtb_mode text CHECK (wbtb_mode IN ('short','long','nap','cat'));
`;
