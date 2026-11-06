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
a local account has no server. They have no password and no data key today, which limits the app lock (below).

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

## The app lock

Nothing of the journal shows until the person proves it is them (PLAN.md §4.3). The decisions are in one tested
function (`packages/shared/src/lock.ts`); `apps/web/src/core/lock.ts` feeds it the real events.

- **When it locks:** on every start, reloads included; when the tab or app is hidden (and, in the desktop app, when
  the window loses focus) for longer than the chosen delay (immediately by default; 30 s, 1, 5 or 15 minutes); after
  idle time (10 minutes by default; 5, 15 or 30 minutes). It can't be turned off, and a saved value that isn't one of
  the choices falls back to the default.
- **What locking does:** the data key is zeroed and dropped from memory, the shells and pages are unmounted so no dream
  is in the page, the query cache with its decrypted answers is emptied, open questions are dismissed, and toasts are
  dropped. A form with unsaved text is lost with its page.
- **System dialogs:** a file picker, the camera or the device's verification takes the app out of sight without the
  person leaving it, so they hold the lock back, for two minutes at most.
- **Unlocking with the password:** the bundle (salt and wrapped key) is asked of the server when it answers, because the
  password may have changed elsewhere, and otherwise comes from a copy on the device made at sign-in. A successful
  unwrap is the proof, with no round trip needed. With no connection, the password that was current at the last
  contact is the one that works.
- **Five wrong passwords in a row** sign the device out, which deletes its copy of the journal, including changes that
  haven't reached the server. The count survives a reload. A cancelled verification or a missing connection isn't a
  wrong try.
- **After an admin reset** there is no wrapped key, so the lock screen says the journal is sealed until the recovery key
  is entered. That entry comes with LDJ-7; until then the only ways on are signing in again and the screen right after.

**Device verification** (web and PWA) uses a WebAuthn platform authenticator with the PRF extension: after the
fingerprint, face or screen lock, the authenticator gives 32 secret bytes that wrap the data key, and only the wrapped
blob is stored on the device. **WebAuthn without PRF can't release a key**: it confirms a presence and nothing more,
and there would be nothing to open the journal with unless the key were stored unprotected. It never is. On such a
device the person is told and uses the password. "Use password instead" is always there.

**The desktop and Android apps** unlock with the password for now. WebAuthn refuses the desktop app's
`http://127.0.0.1` address, and `safeStorage` alone asks for nothing, so keeping the key in it would open the
journal for whoever clicks (LDJ-10). Android's Keystore and BiometricPrompt are LDJ-9. The desktop window's content
protection is on by default, with a setting to allow screenshots. Electron applies it on Windows and macOS; on Linux
it does nothing.

**The honest limits.**

- On the web the lock is real for the key: it is gone from memory, and only the password or the authenticator brings it
  back. But a script running in the page (a malicious extension, a compromised server handing out bad code) sees
  whatever the page sees while unlocked, and can capture the password as it is typed.
- The copy of the journal in the browser's storage is plaintext (see above) and isn't encrypted by the lock. Anyone with
  the unlocked browser profile can read it with the browser's developer tools, without touching the lock screen. The
  lock protects against someone picking up the open app, not against someone with the profile.
- The bundle and the wrong-try count live in the browser's storage. Someone with the profile can copy the bundle
  and guess passwords offline, limited only by Argon2id, or reset the count. A signed-in session can also ask the server
  for the bundle, and gets what sign-in itself hands over.
- A hidden tab's timers are slowed by the browser, so with a delay other than "immediately" the key can stay in memory up to
  about a minute longer than chosen. Coming back always checks the time. JavaScript can't guarantee that no copy of
  a key or of decrypted text is left in memory until it is overwritten.
- An operating system may keep a picture of the app for its task switcher, taken before the app learns it was hidden.
  The web can't prevent that. Android's `FLAG_SECURE` (LDJ-9) and the desktop's content protection can.
- **A local account has no password**, so there is nothing to prove. Its lock screen hides the journal on the same
  triggers, says plainly that it keeps no one out, and opens with a button. It is a privacy screen until local accounts
  get a password or device verification.

**When a session ends without signing out** (it expired, or was ended elsewhere), the tab leaves the device's copy at
once and goes back to the server, and the copy stays closed on the device for the same person's return. If someone
else signs in on this device first, that copy and that person's queued changes are deleted, unsent ones included:
a person's plaintext is never read by, nor sent under the session of, the next person (`packages/shared/src/copyOwner.ts`).
Another tab that sees the session change reloads. Signing out also reloads the page when it has used the copy, because
PGlite holds its IndexedDB connection for the life of the page and the deletion can only finish once the page lets go.
When someone else signs in after an ended session, without a reload, the earlier person's copy is unreachable by the app
at once, and the deletion finishes when that tab next reloads or closes. Until then it is on disk.
