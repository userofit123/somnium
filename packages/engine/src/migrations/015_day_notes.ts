// LDJ-41: day notes (PLAN.md §7.2): a short sealed line about a day, for the dream-lag analysis. One person's (user_id +
// RLS as in 004), soft-deleted and synced like every journal table. The text is sealed (sealed.ts); the date stays plain.
import { syncTriggers } from "../sync/tables";

const ME = "NULLIF(current_setting('app.user_id', true), '')::uuid";

export default /* sql */ `
CREATE TABLE day_notes (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date date NOT NULL,
  text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX day_notes_user_date ON day_notes (user_id, date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON day_notes TO somnium_app;
ALTER TABLE day_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY own ON day_notes TO somnium_app USING (user_id = ${ME}) WITH CHECK (user_id = ${ME});

${syncTriggers(["day_notes"])}
`;
