# Security

How Somnium keeps a journal private. The design is in PLAN.md §4; this page says what is built. Sign-in, the app
lock, recovery and the honest limits of the envelope are filled in with LDJ-11.

## The sealed journal

Everything personal in the journal - dream text and titles, night notes and intentions, element names and
aliases, spans, reality-check and practice notes, course answers, OCR text and the media files themselves - is
encrypted on the device with AES-256-GCM under the account's random 256-bit **data key** before it goes
anywhere. The server and its database hold ciphertext in those columns and never query them. Which columns is
decided in one place, `packages/engine/src/sealed.ts`; every server handler only passes them through, and none
selects, filters or orders by one. Dates, times, counts, booleans and ratings stay plain so the server can
order and page rows; they say nothing on their own.

**Where sealing happens.** Rows cross the device/server line only in sync (`packages/engine/src/sync`):

- **Push** (`replica.localChanges`): the device reads the changed rows from its own copy and seals them
  (`sealing.ts` → `sealRows`) before they are sent to `/sync/push`.
- **Pull** (`replica.applyRemote`) and the **first copy** (`replica.loadSnapshot`): what arrives from
  `/sync/pull` or `/sync/snapshot` is opened (`unsealRows`) before it is written to the device's copy.

Each value is bound to its place by the authenticated data `<table>.<column>.<row id>`: a ciphertext moved to
another row, column or table does not open, so someone holding the database but not the key cannot
reshuffle it. Envelopes are versioned (`v1.<iv>.<ciphertext+tag>`) and fit a text column as they are.

**Without the key** (the app has just opened and sign-in has not yet handed the key over, or the app is
locked) the device syncs nothing: no row of a sealed table is sent or taken, and the sync pill says
**Locked**. The copy keeps working offline; changes wait and go as soon as the key is open again. The key
lives in memory only (`apps/web/src/core/keyring.ts`) and is never written to storage, logs, errors or
exports by the app.

**The device holds plaintext.** The device's copy (PGlite in the browser's storage, in the app's storage on
Android and in Electron) is plaintext so the app can search and analyse offline. It is protected by the device
- its storage, its screen lock - and by the app lock (PLAN.md §4.3). Signing out deletes the copy.

**Local accounts** (no server) keep plaintext in their own database on the device for the same reason, with the
same protection. Nothing of theirs ever leaves the device; sealing applies when data crosses to a server, and
a local account has no server. Their data key exists for backups and for a later move to a server.

**Exports** carry the rows as the database they came from holds them, and say so: `"sealed": true` from the
server (ciphertext, restorable only on the server), `"sealed": false` from a device (plaintext, for the person
to keep and restore anywhere). A sealed export is refused by a device's restore so ciphertext never lands in
a plaintext database.

**The test** (`packages/engine/test/sealing.test.ts`): a dream, a night, an element, a reality check, a practice
entry and a lesson's answers are written through a device with distinctive strings and synced; every table on
the server is then dumped as the database admin and none of those strings, nor any word of them, appears. A
second device opens the same rows from its first copy and from a later pull. A device without the key sends
nothing and takes nothing.
