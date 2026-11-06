// Sign-in with the auth key (PLAN.md §4.1-4.2): the server never sees a password. The device derives two keys from
// it (Argon2id + HKDF, packages/shared/src/crypto/kdf.ts): encKey wraps the account's data key on the device and
// authKey is what the server checks, stored as a scrypt hash in auth_hash. The wrapped data key and the salt are
// public values the server hands back at sign-in; without the password they open nothing.
//
// Nothing is released yet, so the password column is simply replaced: every account signs up again.
//
// Two-factor sign-in: totp_secret (already in 001) is encrypted with the server's own key (DATA_DIR/app.key),
// totp_enabled says whether sign-in asks for a code, and backup_codes holds the eight one-time codes as scrypt
// hashes (a used code keeps its used_at). An admin reset leaves a one-time reset code (hashed, short-lived):
// the person sets a new password with it, but the journal stays sealed until a recovery key or a signed-in
// device re-wraps the data key (§4.4), because the data key only lives in the wrapped blobs.
//
// totp_last_step: the 30-second step of the last authenticator code accepted, so one code works only once.
//
// account_events: notes the server writes about the account itself ("Signed in on Firefox on Linux"), shown in the
// activity log next to the changes from sync_log. Never sealed data; never the device's address.
// device_id: a random id each install makes for itself. Sessions carry it, and the note keeps it too, because
// sessions are deleted at sign-out and a device that signs out and back in is not a new device.
const ME = "NULLIF(current_setting('app.user_id', true), '')::uuid";

export default /* sql */ `
ALTER TABLE users DROP COLUMN password_hash;
ALTER TABLE users
  ADD COLUMN kdf_salt text,
  ADD COLUMN auth_hash text,
  ADD COLUMN wrapped_by_password text,
  ADD COLUMN recovery_salt text,
  ADD COLUMN wrapped_by_recovery text,
  ADD COLUMN recovery_verifier text,
  ADD COLUMN recovery_made_at timestamptz,
  ADD COLUMN totp_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN totp_last_step bigint,
  ADD COLUMN password_changed_at timestamptz,
  ADD COLUMN reset_code_hash text,
  ADD COLUMN reset_expires_at timestamptz;

-- a person reads their own row, but never the sign-in secrets: those columns are the server's alone
REVOKE SELECT ON users FROM somnium_app;
GRANT SELECT (id, username, email, role, display_name, totp_enabled, recovery_made_at, password_changed_at, disabled_at, created_at) ON users TO somnium_app;

ALTER TABLE sessions ADD COLUMN device_id text;

CREATE TABLE backup_codes (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX backup_codes_user ON backup_codes (user_id);
-- a person may count their codes (how many are left), never read the hashes; the server writes them
GRANT SELECT (id, user_id, used_at, created_at) ON backup_codes TO somnium_app;
ALTER TABLE backup_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY own ON backup_codes TO somnium_app USING (user_id = ${ME});

CREATE TABLE account_events (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text text NOT NULL,
  device_id text,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_events_user ON account_events (user_id, at);
GRANT SELECT ON account_events TO somnium_app;
ALTER TABLE account_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY own ON account_events TO somnium_app USING (user_id = ${ME});
`;
