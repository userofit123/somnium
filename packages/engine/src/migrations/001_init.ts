// The first schema: the system tables (sign-in, settings, uploaded files, the change feed).
// Every table that holds someone's data has user_id, and row-level security (002) limits each request to its own rows.
// The journal's own tables come in later migrations, with their sealed columns listed in sealed.ts (PLAN.md §4).
export default /* sql */ `
CREATE TABLE users (
  id uuid PRIMARY KEY,
  username text NOT NULL UNIQUE,
  email text,
  password_hash text,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
  display_name text NOT NULL DEFAULT '',
  totp_secret text,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  device_name text NOT NULL DEFAULT '',
  platform text NOT NULL DEFAULT 'web',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE invites (
  code text PRIMARY KEY,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  used_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE app_meta (key text PRIMARY KEY, value jsonb NOT NULL);

-- a person's settings (packages/shared settings.ts): one JSON document, merged on write
CREATE TABLE user_settings (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE media (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'image',
  mime text NOT NULL,
  size int NOT NULL,
  data bytea,
  path text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE events (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_user ON events (user_id, id);
`;
