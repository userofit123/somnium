// LDJ-80: a dream saved from the morning capture as key words only ("Later"), to be written out when there is time.
// A plain yes/no about the entry, never its words, so it is not sealed; writing it out in the editor clears it.
export default /* sql */ `
ALTER TABLE dreams ADD COLUMN IF NOT EXISTS unfinished boolean NOT NULL DEFAULT false;
`;
