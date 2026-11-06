// Offline use with sync (PLAN.md §2.4): every change to a person's rows is written to sync_log by a trigger, on the
// server and on each device. A device sends the server its changes since it last did, and fetches everyone else's.
// The same triggers run in both places; a device applying the server's rows sets somnium.sync_apply so they aren't sent back.
import { syncTriggers } from "../sync/tables";

const ME = "NULLIF(current_setting('app.user_id', true), '')::uuid";

export default /* sql */ `
CREATE TABLE sync_log (
  seq bigserial PRIMARY KEY,
  user_id uuid NOT NULL, -- no reference: a deleted person's rows go, and their log is cleared with them
  tbl text NOT NULL,
  pk jsonb NOT NULL,
  op text NOT NULL CHECK (op IN ('upsert','delete')),
  at timestamptz NOT NULL DEFAULT now(),
  origin text NOT NULL DEFAULT ''
);
CREATE INDEX sync_log_user ON sync_log (user_id, seq);
CREATE INDEX sync_log_row ON sync_log (user_id, tbl, pk);
GRANT SELECT, INSERT, DELETE ON sync_log TO somnium_app;
GRANT USAGE ON SEQUENCE sync_log_seq_seq TO somnium_app;
ALTER TABLE sync_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY own ON sync_log TO somnium_app USING (user_id = ${ME}) WITH CHECK (user_id = ${ME});

-- TG_ARGV: the row's key columns. A row without an owner is never logged.
CREATE FUNCTION somnium_log_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r jsonb; owner uuid; k jsonb := '{}'; c text;
BEGIN
  IF current_setting('somnium.sync_apply', true) = '1' THEN RETURN NULL; END IF;
  r := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
  owner := COALESCE(r->>'user_id', r->>'owner_id')::uuid;
  IF owner IS NULL THEN RETURN NULL; END IF;
  FOREACH c IN ARRAY TG_ARGV LOOP k := k || jsonb_build_object(c, r->c); END LOOP;
  INSERT INTO sync_log (user_id, tbl, pk, op, at, origin) VALUES (owner, TG_TABLE_NAME, k,
    CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END,
    COALESCE(NULLIF(current_setting('somnium.sync_at', true), '')::timestamptz, now()),
    COALESCE(current_setting('somnium.sync_origin', true), ''));
  RETURN NULL;
END $$;

-- only the tables that exist at this point; later migrations add their own (sync/tables.ts)
${syncTriggers(["user_settings"])}
`;
