// LDJ-111: a reality check remembers the dream sign it was paired with (the sign's element id, plain like every other
// id: it says which row, not what the sign is), so Insights can count checks per sign. No foreign key: a check made
// over the lock screen or from a phone's queue may arrive before or after the element itself syncs, and a sign removed
// later leaves its checks counted as checks.
// A dream sign's waking triggers ("when I see a teacher"): the person's own words, so sealed (sealed.ts) and text.
export default /* sql */ `
ALTER TABLE reality_checks ADD COLUMN IF NOT EXISTS sign_id uuid;
ALTER TABLE elements ADD COLUMN IF NOT EXISTS triggers text;
`;
