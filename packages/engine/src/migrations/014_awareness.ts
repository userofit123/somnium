// LDJ-50: the Dreamsign Awareness Scale (Lucidity Institute course, RESEARCH.md 1.8) as an optional rating per dream.
// A plain number 0-4 (never text), so it is not sealed and /dream-facts and the sync carry it like lucidity_level.
export default /* sql */ `
ALTER TABLE dreams ADD COLUMN awareness int CHECK (awareness BETWEEN 0 AND 4);
`;
