// The journal itself (PLAN.md §5): nights, dreams, the person's elements and dream signs, reality checks, practice,
// the course, goals and reminders. Every table is one person's (user_id + RLS as in 002), is never hard-deleted by
// the app (deleted_at, so a deletion syncs like any change) and logs its changes for sync (003).
// Sealed columns (PLAN.md §4, marked (S) there) are plain text holding the envelope the device made; the server
// never reads them. Their list lives in sealed.ts.
import { syncTriggers } from "../sync/tables";

const ME = "NULLIF(current_setting('app.user_id', true), '')::uuid";
const OWNED = ["nights", "dreams", "elements", "dream_elements", "reality_checks", "practice_log", "course_progress", "goals", "reminders"];

export default /* sql */ `
-- a night is the morning's date; the dreams of that night hang off it
CREATE TABLE nights (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date date NOT NULL,
  bedtime timestamptz,
  wake_time timestamptz,
  sleep_quality int CHECK (sleep_quality BETWEEN 1 AND 5),
  wbtb_used boolean NOT NULL DEFAULT false,
  wbtb_wake_at timestamptz,
  wbtb_minutes_awake int CHECK (wbtb_minutes_awake BETWEEN 0 AND 600),
  nap boolean NOT NULL DEFAULT false,
  substances text,
  caffeine_after time,
  alcohol boolean NOT NULL DEFAULT false,
  notes text,
  techniques_planned text[] NOT NULL DEFAULT '{}',
  techniques_done text[] NOT NULL DEFAULT '{}',
  intention text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX nights_user_date ON nights (user_id, date DESC);

CREATE TABLE dreams (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  night_id uuid NOT NULL REFERENCES nights(id) ON DELETE CASCADE,
  position int NOT NULL DEFAULT 0,
  title text,
  text text,
  lucid boolean NOT NULL DEFAULT false,
  lucidity_level int NOT NULL DEFAULT 0 CHECK (lucidity_level BETWEEN 0 AND 5),
  control int CHECK (control BETWEEN 0 AND 5),
  vividness int CHECK (vividness BETWEEN 1 AND 5),
  recall_clarity int CHECK (recall_clarity BETWEEN 1 AND 5),
  emotion_overall int CHECK (emotion_overall BETWEEN -2 AND 2),
  duration_est int CHECK (duration_est BETWEEN 0 AND 600),
  nightmare boolean NOT NULL DEFAULT false,
  recurring boolean NOT NULL DEFAULT false,
  false_awakening boolean NOT NULL DEFAULT false,
  sleep_paralysis boolean NOT NULL DEFAULT false,
  became_lucid_how text CHECK (became_lucid_how IN ('dream_sign','reality_check','wild','spontaneous','nightmare','other')),
  lucid_trigger text,
  wake_method text CHECK (wake_method IN ('alarm','natural','wbtb')),
  favourite boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX dreams_user_night ON dreams (user_id, night_id, position);
CREATE INDEX dreams_user_created ON dreams (user_id, created_at DESC);

-- the person's own taxonomy of what appears in their dreams; a dream sign is an element flagged as one
CREATE TABLE elements (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('character','place','object','action','emotion','theme','sensation','dream_sign')),
  name text,
  aliases text,
  colour text,
  note text,
  is_dream_sign boolean NOT NULL DEFAULT false,
  sign_category text CHECK (sign_category IN ('inner_awareness','action','form','context')),
  confirmed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX elements_user ON elements (user_id, kind);

CREATE TABLE dream_elements (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dream_id uuid NOT NULL REFERENCES dreams(id) ON DELETE CASCADE,
  element_id uuid NOT NULL REFERENCES elements(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','detected','ocr')),
  confidence real CHECK (confidence BETWEEN 0 AND 1),
  span text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX dream_elements_dream ON dream_elements (dream_id);
CREATE INDEX dream_elements_element ON dream_elements (element_id);
-- one live link per dream and element; a removed link can be made again
CREATE UNIQUE INDEX dream_elements_live ON dream_elements (dream_id, element_id) WHERE deleted_at IS NULL;

-- uploaded files (001) become a dream's photos, sketches and recordings
UPDATE media SET kind = 'photo' WHERE kind = 'image';
ALTER TABLE media
  ALTER COLUMN kind SET DEFAULT 'photo',
  ADD CONSTRAINT media_kind CHECK (kind IN ('photo','sketch','audio')),
  ADD COLUMN dream_id uuid REFERENCES dreams(id) ON DELETE SET NULL,
  ADD COLUMN ocr_text text,
  ADD COLUMN duration int CHECK (duration BETWEEN 0 AND 86400),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN deleted_at timestamptz;
CREATE INDEX media_dream ON media (dream_id);

CREATE TABLE reality_checks (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL DEFAULT 'other' CHECK (kind IN ('nose','hands','text','clock','light','jump','finger_palm','other')),
  outcome text NOT NULL DEFAULT 'awake' CHECK (outcome IN ('awake','unsure','dreaming')),
  prompted boolean NOT NULL DEFAULT false,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX reality_checks_user_at ON reality_checks (user_id, at DESC);

-- a day's practice: item is a lesson, technique or habit id from the bundled content
CREATE TABLE practice_log (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date date NOT NULL,
  item text NOT NULL,
  done boolean NOT NULL DEFAULT true,
  minutes int CHECK (minutes BETWEEN 0 AND 1440),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX practice_log_user_date ON practice_log (user_id, date DESC);

CREATE TABLE course_progress (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id text NOT NULL,
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','active','done','skipped')),
  done_at timestamptz,
  answers text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX course_progress_lesson ON course_progress (user_id, lesson_id) WHERE deleted_at IS NULL;

CREATE TABLE goals (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('recall_per_week','lucid_per_month','checks_per_day','journal_streak')),
  target int NOT NULL CHECK (target BETWEEN 1 AND 1000),
  period text NOT NULL DEFAULT 'week' CHECK (period IN ('day','week','month')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX goals_user ON goals (user_id);

-- "on" is a reserved word in SQL, so the switch is called enabled
CREATE TABLE reminders (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('reality_check','bedtime','wbtb','morning_journal','practice','custom')),
  schedule jsonb NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX reminders_user ON reminders (user_id);

${OWNED.map((t) => `
GRANT SELECT, INSERT, UPDATE, DELETE ON ${t} TO somnium_app;
ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;
CREATE POLICY own ON ${t} TO somnium_app USING (user_id = ${ME}) WITH CHECK (user_id = ${ME});`).join("\n")}

${syncTriggers([...OWNED, "media"])}
`;
