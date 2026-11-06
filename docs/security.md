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

**Where sealing happens.** Rows cross the device/server line in sync and in the direct API path
(`packages/engine/src/sync`):

- **Push** (`replica.localChanges`): the device reads the changed rows from its own copy and seals them
  (`sealing.ts` → `sealRows`) before they are sent to `/sync/push`.
- **Pull** (`replica.applyRemote`) and the **first copy** (`replica.loadSnapshot`): what arrives from
  `/sync/pull` or `/sync/snapshot` is opened (`unsealRows`) before it is written to the device's copy.
- **The direct API** (`sealedApi.ts`, used by `httpTransport` in `apps/web/src/api/client.ts`): when the copy is
  not in use (the first copy still opening, a second tab, no IndexedDB or WebAssembly, a failed first copy), the
  app calls the journal routes itself. Request bodies are sealed before they leave and answers are opened when they
  arrive; the row id is made on the device, because each value is bound to it. `/import` and `/export` go table
  by table. A restore's preview is answered on the device, so the file is never sent just to be counted.
- **Media files**: `POST /api/media` receives the file sealed with `sealBytes`, under the id the device made for it;
  `apps/web/src/api/media.ts` opens it after `GET /api/media/:id` and gives the screens an object URL. A file's kind,
  type and size stay plain.

**The server refuses plaintext.** As a second line of defence, every engine handler that writes a sealed column,
sync push, import and the media route answer 400 "must be sealed by the app" to a value that is not an envelope. A
device's own database and a local account accept plaintext, since that is where plaintext belongs.

Each value is bound to its place by the authenticated data `<table>.<column>.<row id>`: a ciphertext moved to
another row, column or table does not open, so someone holding the database but not the key cannot
reshuffle it. Envelopes are versioned (`v1.<iv>.<ciphertext+tag>`) and fit a text column as they are.

**Without the key** (the app has just opened and sign-in has not yet handed the key over, or the app is
locked) no row of a sealed table is sent or taken, and the sync pill says **Not syncing · locked**. Settings, goals
and reminders hold nothing sealed and keep syncing. The copy keeps working offline; journal changes wait and go as
soon as the key is open again. With no copy in use, journal requests are refused on the device with "Unlock to
sync" instead of being sent. The key lives in memory only (`apps/web/src/core/keyring.ts`) and is never written to
storage, logs, errors or exports by the app. Callers get a copy of it, which they zero when done, and a zeroed key
refuses to seal or open anything.

**Limits we accept.** On the way in, a value that is not an envelope is kept as plain text. A hostile server could
therefore inject text into the journal (a false dream, say), though it still could not read anything. A row whose
envelope does not open (a wrong key, a changed byte, a value moved from another row) is skipped and reported in the
sync status with a count, and never stalls the rest of the page; it is kept as ciphertext and tried again on each
later sync.

**The device holds plaintext.** The device's copy (PGlite in the browser's storage, in the app's storage on
Android and in Electron) is plaintext so the app can search and analyse offline. It is protected by the device
(its storage and its screen lock) and by the app lock (PLAN.md §4.3). Signing out deletes the copy.

**Local accounts** (no server) keep plaintext in their own database on the device for the same reason, with the
same protection. Nothing of theirs ever leaves the device; sealing applies when data crosses to a server, and
a local account has no server. Their data key exists for backups and for a later move to a server.

**Exports** carry the rows as the database they came from holds them, and say so: `"sealed": true` from the
server (ciphertext, restorable only on the server), `"sealed": false` from a device (plaintext, for the person
to keep and restore anywhere). The app opens a server's export on the device before saving it, so what a person
downloads is plaintext either way, and seals a plaintext file again before restoring it to a server. A sealed
export is refused by a device's restore so ciphertext never lands in a plaintext database.

**The test** (`packages/engine/test/sealing.test.ts`): a dream, a night, an element, a reality check, a practice
entry and a lesson's answers are written through a device with distinctive strings and synced; every table on
the server is then dumped as the database admin and none of those strings, nor any word of them, appears. A
second device opens the same rows from its first copy and from a later pull. A device without the key sends
and takes only the plain tables. The same check runs on the direct API path, and `apps/server/test/media.test.ts`
looks for a marker from an uploaded photo in the database dump and in every file under the media folder.
