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
- Every request to `/sync/*` says whose copy it comes from (`x-somnium-copy-user`). The server answers 409 under any other
  session, and the device then sends nothing more and starts over, so one person's rows can't reach another's account.
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
local account's own database runs under the same rule (below). A server account's copy on a device accepts
plaintext, since that is where its plaintext belongs.

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

**Local accounts** (no server; LDJ-53) are sealed at rest. Making one asks for a password (10+ characters, not on
the common-password list, typed twice), makes the data key on the device and offers the recovery key at once. The
envelope (salt, data key wrapped by the password, recovery salt, data key wrapped by the recovery key, recovery
verifier) is kept in the account's own record: `accounts.json` in the desktop app's user folder (file mode 600),
the account list in the Android app's storage. Their database (files in the desktop app, PGlite in the Android
WebView's IndexedDB) holds the sealed columns as ciphertext, exactly as a server does: the app seals on the way in
and opens on the way out through the same code a server account uses without a device copy
(`apps/web/src/api/client.ts` `sealingTransport`), and the engine runs with the server's rule, refusing a sealed
column in the clear. So a copied database folder holds no dream text without the password or the recovery key
(`packages/engine/test/local-at-rest.test.ts` writes through that path to a database on disk and searches every
byte of its files). Dates, counts and ratings stay plain, as on a server. The search and analysis screens work on
what the engine hands back, opened in memory; nothing opened is written back to disk.
A local account made before this (development builds only) is asked to set a password on its next start; what it
holds is then exported, sealed and restored in one transaction, and the database is compacted (`VACUUM FULL`, the
write-ahead log cycled) so the old plaintext rows leave its files. Two limits there: the storage underneath (a disk's
free blocks, an SSD's spare area, IndexedDB's own files) may keep old bytes until they are overwritten, and photos a
desktop local account stored as files before this stay as they were (new ones are sealed). Making a fresh account
from a backup leaves neither behind.

**Exports** carry the rows as the database they came from holds them, and say so: `"sealed": true` from the
server or a local account (ciphertext), `"sealed": false` from a server account's device copy (plaintext, for the
person to keep and restore anywhere). The app opens a sealed export on the device before saving it, so what a person
downloads is plaintext either way, and seals a plaintext file again before restoring it to a server. A sealed
export is refused by a server account's device copy so ciphertext never lands in a plaintext database. A backup
from a local account is therefore the same file as one from a server account, and restores into a server (moving the
account there) the same way.

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
  is in the page, the query cache with its decrypted answers is emptied, open questions are dismissed, toasts are
  dropped, and a question or toast raised later stays away until the next unlock. A session ending does all of this too.
  A form with unsaved text is lost with its page.
- **What can remain for a moment after locking:** work that seals or opens rows uses its own copy of the key, one step at
  a time (a batch of rows in a sync, the first copy's rows, a file, a request's body on the direct path, the slow
  re-wrap when the password changes). A step already running finishes with its copy, because zeroing it midway would seal
  rows with zeros; the copy is zeroed as the step ends, and no further step starts. So the key can stay in memory for
  as long as that one step takes, usually under a second, and with a big first copy or a slow password derivation a few
  seconds. Sealing a request's body can include the lookup it needs from the server, up to 20 seconds at worst. The
  other copies wait for no server answer. Text the step has opened stays in JavaScript's memory until it is collected:
  JavaScript strings can't be zeroed. A request already sent can't be recalled, but its answer isn't opened, and a file
  that finishes opening after the lock isn't kept. The password itself and Web Crypto's internal copies of keys can't be
  zeroed either.
- **System dialogs:** a file picker, the camera or the device's verification takes the app out of sight without the
  person leaving it, so they hold the lock back, for two minutes at most.
- **Unlocking with the password:** the bundle (salt and wrapped key) is asked of the server when it answers, because the
  password may have changed elsewhere, and otherwise comes from a copy on the device made at sign-in. A successful
  unwrap is the proof, with no round trip needed. With no connection, the password that was current at the last
  contact is the one that works.
- **Wrong tries cost time and nothing else.** A wrong password never deletes anything or signs anyone out. After five
  wrong tries in a row, each further try has to wait: 1 minute, then 5, then 15, then 1 hour for every try after that.
  The journal stays locked, the screen shows a countdown, and a try during a wait is refused before the password is
  looked at. The right password starts the count over. Device verification follows the same count when it answers with
  something that doesn't open the key; a cancelled verification or a missing connection never counts. The count and the
  time of the last try are stored on the device, so reloading or restarting doesn't skip the wait. A clock moved back
  counts as still waiting: the whole wait starts over from then, and it ends without moving the clock forward again.
- **The limits of that wait:** it slows down someone using the app's own lock screen. It runs on the device, so moving
  the clock forward shortens it and clearing the browser's data resets it. Anyone able to do that already has the
  browser profile, which holds the plaintext copy (see the limits below) and the wrapped key that could be attacked
  directly; only the password's strength and Argon2id stand against that.
- **Signing out** is a choice on the lock screen, and it still deletes this device's copy. If changes haven't reached the
  server, it says so first.
- **Two people on one browser:** when someone else signs in, the earlier person's copy is deleted only if it holds nothing
  unsent. A copy with unsent changes, or one the device can't vouch for, is kept, as are changes queued for that person, and
  they are sent when that person next signs in and unlocks. Copies are separate per person and nothing of the kept copy is
  shown or sent under another session. The limit: the kept copy stays on that device, in plaintext, until then, and if
  that person never comes back it stays there. Anyone with that browser profile can read it with developer tools,
  including the person who signed in next. Removing it takes signing in as its owner and signing out, or clearing the
  browser's data, which loses the unsent changes.
- **After an admin reset** there is no wrapped key, so the lock screen says the journal is sealed until the recovery key
  is entered there (see The recovery key, below).

**Device verification** (web and PWA) uses a WebAuthn platform authenticator with the PRF extension: after the
fingerprint, face or screen lock, the authenticator gives 32 secret bytes that wrap the data key, and only the wrapped
blob is stored on the device, under that person's id: it is never offered to anyone else, and goes when someone else
signs in here. The same holds for the device's copy of the password bundle. **WebAuthn without PRF can't release a key**: it confirms a presence and nothing more,
and there would be nothing to open the journal with unless the key were stored unprotected. It never is. On such a
device the person is told and uses the password. "Use password instead" is always there.

**The desktop and Android apps** unlock with the password for now. WebAuthn refuses the desktop app's
`http://127.0.0.1` address, and `safeStorage` alone asks for nothing, so keeping the key in it would open the
journal for whoever clicks (LDJ-10). Android's Keystore and BiometricPrompt are LDJ-9. The desktop window's content
protection is on by default, with a setting to allow screenshots. It is a request to the system, on Windows and macOS,
and capture tools may ignore it. On Linux it does nothing, so the setting isn't shown there.

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
- **A local account's lock** works like a server account's: the password opens the data key from the account's own
  record, a forgotten password is replaced with the recovery key (which is then replaced too), wrong passwords and wrong
  recovery keys wait 1, 5, 15 and 60 minutes after five, and nothing is ever deleted. The record and the wrong-try count
  are on the device, so someone with a copy of the app's storage can guess passwords offline, limited only by Argon2id,
  or reset the count. Device verification is the password in the desktop and Android apps until LDJ-9 and LDJ-10:
  WebAuthn refuses the desktop app's `http://127.0.0.1` address and the Android app has its own path.

**When a session ends without signing out** (it expired, or was ended elsewhere), the tab leaves the device's copy at
once and goes back to the server, and the copy stays closed on the device for the same person's return. If someone
else signs in on this device first, that copy goes only if it holds nothing unsent. With unsent changes it stays, closed,
with that person's queued changes, until they sign in and unlock again (see "Two people on one browser" above):
a person's plaintext is never read by, nor sent under the session of, the next person (`packages/shared/src/copyOwner.ts`).
Another tab that sees the session change reloads. Signing out also reloads the page when it has used the copy, because
PGlite holds its IndexedDB connection for the life of the page and the deletion can only finish once the page lets go.
When someone else signs in after an ended session and this page still holds an earlier copy that may go, the copy is
unreachable by the app at once and the page reloads once, so the deletion really finishes; the person who just signed in
then unlocks. If another tab still holds it too, it stays on disk until that tab reloads or closes.

## The recovery key

Made on the device in Settings → Security (or straight after sign-up), from the open data key, and shown once:
20 characters from 31 unambiguous ones. Argon2id over it gives two HKDF keys: one wraps the data key and never
leaves the device; the other, the verifier, goes to the server and is kept only as a scrypt hash. The server holds
the salt, the wrapped key and that hash, so it cannot open the journal with what it has.

**Forgot password** (sign-in screen, or the lock screen): the device asks `/api/auth/recovery/salt` (an unknown
name, or an account without a key, gets a stand-in salt that is the same every time), derives the verifier and sends
it to `/api/auth/recovery/open`. Only a right verifier gets the wrapped data key back; a wrong key, an unknown name
and a missing key get the same answer, and every try counts against the same limit as signing in. The device opens
the data key, re-wraps it under a new password and makes a new recovery key; `/api/auth/recovery/finish` checks the
verifier again and swaps password and recovery key in one statement bound to the old verifier, so a key works once
even when two requests race. With two-factor sign-in on, an authenticator or backup code is needed too. Every other
session ends and the activity log notes it.

The limit: `/api/auth/recovery/open` hands back the wrapped data key before any second factor is asked for, so a
stolen recovery key opens any sealed copy of the journal - a dump of the server, a sealed export or backup - even with
two-factor sign-in on. Two-factor still guards the next step: setting a new password and signing in with it.

**After an admin reset** the password no longer wraps the data key, and the journal is sealed. A reset signs out
every device and none of them keeps the key, so only the recovery key opens it again (on the lock screen, which
also comes straight after signing in). There it asks for the password just signed in with, sent as `current` and
checked against the reset's auth hash before anything is stored, so a typo is refused instead of quietly becoming
the new sign-in password. Device-held keys that would survive this are LDJ-10.
