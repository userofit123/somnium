// LDJ-159: what you will do once lucid, planned with the night, and afterwards whether you did it. The plan is the
// person's words, so nights.lucid_plan is sealed (sealed.ts) like the intention beside it: its own column, not folded
// into the intention, because the intention is about becoming lucid and MILD repeats the plan after it. Whether the
// plan was carried out is a plain answer from a fixed list (packages/shared/src/types.ts PLAN_DONE), kept on the dream
// that was lucid, like lucid_end: "yes, partly, no" says nothing on its own.
export default /* sql */ `
ALTER TABLE nights ADD COLUMN IF NOT EXISTS lucid_plan text;
ALTER TABLE dreams ADD COLUMN IF NOT EXISTS plan_done text CHECK (plan_done IN ('yes','partly','no'));
`;
