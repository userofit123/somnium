// LDJ-52, third round: a merged night that couldn't be settled (its dreams not moved, its fields not merged) is marked
// here and tried again on the next push or pull, on the server as on a device, without looking through every merged
// night ever made (the partial index holds only the marked ones). Each side keeps its own mark: it is never sent or
// taken in sync (sync/core.ts strips it), and setting or clearing it isn't logged. Plain: it says nothing personal.
export default /* sql */ `
ALTER TABLE nights ADD COLUMN IF NOT EXISTS merge_pending boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS nights_merge_pending ON nights (id) WHERE merge_pending;
`;
