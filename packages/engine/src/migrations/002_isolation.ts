// Row-level security: every request runs as the role somnium_app with app.user_id set to the signed-in person,
// so even a query that forgets "WHERE user_id = ..." cannot see or change anyone else's rows.
// Sign-in tables (sessions, invites, app_meta) are not granted to somnium_app at all: only the server's own code reads them.
// Later migrations grant and protect their own tables the same way (copy the three lines per table).
const OWNED = ["user_settings", "media", "events"];
const ME = "NULLIF(current_setting('app.user_id', true), '')::uuid";

export default /* sql */ `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'somnium_app') THEN CREATE ROLE somnium_app NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO somnium_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO somnium_app;

${OWNED.map((t) => `
GRANT SELECT, INSERT, UPDATE, DELETE ON ${t} TO somnium_app;
ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;
CREATE POLICY own ON ${t} TO somnium_app USING (user_id = ${ME}) WITH CHECK (user_id = ${ME});`).join("\n")}

-- a person sees and edits only their own user row (name, profile); sign-in fields are changed by the server only
GRANT SELECT ON users TO somnium_app;
GRANT UPDATE (display_name, email) ON users TO somnium_app;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY self ON users TO somnium_app USING (id = ${ME});
`;
