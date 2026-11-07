# Security

What protects your journal, and what does not. The plain version comes first; the full audit follows. The design is
in PLAN.md §4; every statement here was checked against the code, and the file names say where. Parts still being
finished are marked "in progress".

## What, in short

- **The journal is sealed.** Dream text, titles, notes and every other personal field are encrypted on your device
  before they are stored or synced. Your server holds only scrambled text and cannot read it, nor can its admin.
- **The price of that is real:** if you lose the password and the recovery key and no signed-in device is left, nobody
  can read the journal. That is the point of it.
- **The password never leaves your device.** The server is given a separate value made from it (the authKey) that
  cannot unlock anything.
- **An app lock is on every device** and cannot be turned off, only given a delay. But it is a screen lock: the data
  already opened on the device is as safe as the device itself (see "The app lock" and "Not covered").
- **Nothing is sent anywhere but your own server** (and, optionally, GitHub's public release list to see if there is a
  newer version, with nothing that identifies you). No analytics, no crash reports, no cloud analysis, no account with us.
- **Dates, times, counts and ratings are not sealed**, so the server can sort and page them. Your server can see
  *when* you logged a night and how it was rated, never what you dreamed.
- **Use a strong password, turn on two-factor sign-in, save the recovery key somewhere safe, and keep disk
  encryption on** on every computer and phone that holds a copy.

## Where your data is

| Install | Account kind | Where the journal lives | What protects it there |
|---|---|---|---|
| **Web / phone page (PWA)** | Server account | On your server (sealed), plus a **copy in the browser's storage** (PGlite in IndexedDB) that is **plaintext** so search and analysis work offline | The server holds ciphertext. The copy is protected by the browser profile, the device and the app lock. Signing out deletes it. |
| **Desktop app** | Local account | On this computer, in the app's own database folder, **sealed at rest**; the account's keys are in `accounts.json` in the app's user folder | Password and recovery key. The file is readable by this user only (mode 600; on Windows the user folder's own permissions apply). |
| **Desktop app** | Server account | On your server (sealed), plus a plaintext copy in that account's own browser partition on the computer | As for the web |
| **Android app** | Local account | In the app's storage on the phone (PGlite in the WebView's IndexedDB), **sealed at rest**, the account list in the app's storage | Password, recovery key, phone verification. App backup to Google is off (`allowBackup="false"`). |
| **Android app** | Server account | On your server (sealed) plus a plaintext copy in the app's storage | As for the web, plus the phone's verification |
| **Your server (Docker)** | | PostgreSQL in a Docker volume (sealed columns and plain columns), photos and recordings as sealed files in the `appdata` volume (`/data/media`, mode 600), the server's key in `/data/app.key` | See "The network" |

A **local account** has no server at all (the desktop app runs the engine inside itself on `127.0.0.1`; the phone
runs it in the app). A **server account** keeps the authoritative copy on your server and a working copy on each
device so the app opens and works with no connection.

**Accounts here have no email, no name and nothing personal.** The server stores a username, a display name you
choose, hashes and wrapped keys, and the sealed journal.

---

## The full audit

## The sealed journal

### What is sealed, what is not

Sealed (encrypted on the device with AES-256-GCM under the account's random 256-bit **data key**): dream text and
titles, the sign named as the lucid trigger, the words of a detection you dismissed, night notes, intentions,
substances and the "absorbed" note, element names, aliases and notes, the span of text an element is linked to,
reality-check and practice notes, course answers, OCR text and the media files themselves (photos, sketches,
recordings). Free-text settings would be sealed one by one, but there are none yet (`SEALED_SETTING_KEYS` is empty).
The list is decided in one place, `packages/engine/src/sealed.ts`;
the server's handlers only pass those columns through, and none selects, filters or orders by one. A new personal
column goes on that list.

Plain (the server can read it): dates, times, counts, booleans (lucid, nightmare, WBTB used), ratings (lucidity level,
vividness, sleep quality), technique ids, a file's kind, type and size, the settings that hold nothing personal,
reminder times, your username and display name, and each row's ids and timestamps. These say nothing about content on
their own, but they do show *when and how often* you write, and how you rated a night. The plain list is deliberate
and documented in `sealed.ts`.

Each value is bound to its place by the authenticated data `<table>.<column>.<row id>`: a ciphertext moved to another
row, column or table does not open, so someone holding the database cannot reshuffle it. Values are versioned
envelopes (`v1.<iv>.<ciphertext+tag>`) that fit a text column as they are.

### Keys and envelopes

- The **data key** is random, made on the device, never shown and never sent. It is stored only **wrapped** (AES-256-GCM
  under a key-encryption key, bound to a fixed label so a wrapped key can never be taken for a sealed value;
  `packages/shared/src/crypto/keys.ts`).
- The **password key**: Argon2id (64 MiB, 3 passes) over the password and an account salt, then two independent HKDF
  outputs. `encKey` wraps the data key and stays on the device. `authKey` is what the server checks, stored as a scrypt hash.
  `authKey` cannot be turned back into `encKey`; to open anything the server would have to guess the password itself and
  run Argon2id for each guess (`packages/shared/src/crypto/kdf.ts`). This is Bitwarden's model.
- The **recovery key** wraps the same data key (see "Getting back in").
- A **device key** (phone only) wraps it a third time under the phone's Keystore.
- Changing the password re-wraps the data key; the journal is not re-encrypted. Making a new recovery key re-wraps too.
- The password is NFC-normalised, 10+ characters and checked against the 10,000 most common passwords
  (`packages/shared/src/password.ts`).

### Where sealing happens

Rows cross the device/server line in sync and in the direct API path (`packages/engine/src/sync`):

- **Push** (`replica.localChanges`): the device seals the changed rows (`sealing.ts`, `sealRows`) before `/sync/push`.
- **Pull** (`replica.applyRemote`) and the **first copy** (`replica.loadSnapshot`): what arrives from `/sync/pull` or
  `/sync/snapshot` is opened (`unsealRows`) before it is written to the device's copy.
- Every `/sync/*` request says whose copy it comes from (`x-somnium-copy-user`). The server answers 409 under any other
  session, and the device then sends nothing more and starts over, so one person's rows cannot reach another's account
  (`apps/server/test/copy-owner.test.ts`).
- **The direct API** (`sealedApi.ts`, used by `httpTransport` in `apps/web/src/api/client.ts`), when the copy is not in
  use (the first copy still opening, a second tab, no IndexedDB or WebAssembly): request bodies are sealed before they
  leave and answers opened when they arrive; the row id is made on the device, because each value is bound to it.
  `/import` and `/export` go table by table. A restore's preview is answered on the device, so the file is never sent
  just to be counted.
- **Media files**: `POST /api/media` receives the file sealed (`sealBytes`) under the id the device made for it;
  `apps/web/src/api/media.ts` opens it after `GET /api/media/:id` and gives the screens an object URL (revoked when the
  journal locks). The photo cache of the service worker holds the files as the server does, sealed, and signing out
  deletes it (`apps/web/public/sw.js`). Photos have their EXIF (place, time, camera) removed on the device before
  sealing, by redrawing them (`apps/web/src/core/image.ts`).

**The server refuses plaintext.** As a second line of defence, every engine handler that writes a sealed column (sync
push, import) and the media route answer 400 "must be sealed by the app" to a value that is not an envelope. A local
account's own database runs under the same rule. A server account's copy on a device accepts plaintext, since that is
where its plaintext belongs.

**Limits we accept.** On the way in, a value that is not an envelope is kept as plain text, so a hostile server could
inject text into the journal (a false dream, say), though it still could not read anything. A row whose envelope does
not open (wrong key, a changed byte, a value moved from another row) is skipped and counted in the sync status, never
stalls the rest of the page, and is tried again on each later sync.

### Without the key

When the app has just opened and sign-in has not yet handed the key over, or the app is locked, no row of a sealed
table is sent or taken, and the sync pill says **Not syncing · locked**. Settings, goals and reminders hold nothing
sealed and keep syncing. The copy keeps working offline; journal changes wait and go as soon as the key is open.
With no copy in use, journal requests are refused on the device with "Unlock to sync" instead of being sent.

While the key is closed the device answers no journal route at all (`allowedWithoutKey` in
`packages/engine/src/sync/sealedApi.ts`, checked by both transports). The lock and `/check` screens read nothing of
the journal; the one journal request let through is a new reality check from `/check` with nothing sealed in it. Every
screen is unmounted while locked, which also stops code that still runs (the reminders) from reading the journal.

The key lives in memory only (`apps/web/src/core/keyring.ts`) and is never written to storage, logs, errors or exports.
Callers get a copy, which they zero when done; a zeroed key refuses to seal or open anything.

### The device holds plaintext

The device's copy of a server account is plaintext so the app can search and analyse offline. It is protected by the
device (its storage and screen lock) and by the app lock, **not by encryption**. Signing out deletes it. Local accounts
are different, below.

### Local accounts

A local account has no server and is **sealed at rest** (LDJ-53). Making one asks for a password (10+ characters, not
on the common list, typed twice), makes the data key on the device and offers the recovery key at once. The envelope
(salt, data key wrapped by the password, recovery salt, data key wrapped by the recovery key, recovery verifier) is in
the account's own record: `accounts.json` in the desktop app's user folder (each change is written to a new file with
mode 600 and renamed over the old one, and the mode is set again at every start, so a file left by an older version is
tightened too), the account list in the Android app's storage.

Their database holds the sealed columns as ciphertext, exactly as a server does: the app seals on the way in and opens
on the way out through the same code a server account uses without a copy (`sealingTransport` in
`apps/web/src/api/client.ts`), and the engine runs with the server's rule, refusing a sealed column in the clear. So a
copied database folder holds no dream text without the password or the recovery key
(`packages/engine/test/local-at-rest.test.ts` writes through that path to a database on disk and searches every byte
of its files). Dates, counts and ratings stay plain, as on a server. What the screens open is held in memory and not
written back to disk.

A local account made before this (development builds only) is asked to set a password on its next start; what it holds
is exported, sealed and restored in one transaction, and the database is compacted (`VACUUM FULL`, the write-ahead log
cycled) so old plaintext rows leave its files. Two limits: the storage underneath (a disk's free blocks, an SSD's
spare area, IndexedDB's own files) may keep old bytes until overwritten, and photos a desktop local account stored as
files before this stay as they were (new ones are sealed).

### Exports

Exports carry the rows as the database they came from holds them, and say so: `"sealed": true` from a server or a
local account (ciphertext), `"sealed": false` from a server account's device copy (plaintext). The app opens a sealed
export on the device before saving it, so **what you download is plaintext either way**, and seals a plaintext file
again before restoring it to a server. A sealed export is refused by a server account's device copy, so ciphertext
never lands in a plaintext database. See also "Backups".

## Sign-in

- **Server accounts only** (a local account has no sign-in, only the lock). The first account on a server is the admin;
  after that registration is by **invite** (a code valid for 14 days), open or closed, as the admin chooses.
  Usernames are 2-40 letters, digits, dots, dashes or underscores.
- The device derives the `authKey` from the password and sends only that, with the account's salt it asked for first.
  The server stores a **scrypt** hash of it. An unknown name gets a stand-in salt that is the same every time, so
  nobody can tell by asking whether a name exists (`standInSalt`, an HMAC under the server's key).
- **Sessions** are 32 random bytes; only their SHA-256 hash is stored. On the web they are an `HttpOnly`,
  `SameSite=Strict` cookie, `Secure` when the request came over HTTPS (the server trusts the proxy's `X-Forwarded-Proto`); the apps use a bearer token. They last **60 days, sliding** (`SESSION_DAYS` changes it).
  Settings → Security lists the signed-in devices and ends any of them; "sign out other devices" ends the rest.
  Changing the password, or any recovery, ends every other session.
- A request using the cookie must also carry the `X-Somnium: 1` header on any change (other sites cannot add it).
  Every `/api` call needs a session except the status, salt, sign-up, sign-in, reset, recovery and version / update-check
  routes (which have their own checks). The page
  itself is public and holds no data.
- **Two-factor sign-in** (TOTP, RFC 6238, any authenticator app) with **eight one-time backup codes** shown when it is
  turned on (stored as scrypt hashes, each used once; making new ones replaces them). The TOTP secret is stored
  encrypted with the **server's own key** (`DATA_DIR/app.key`, made on the first start with mode 600, or `APP_KEY`),
  which is not the journal's key (the server has none). A code is accepted once only. Turning it on and off needs a code,
  and `/2fa/start` is refused while it is on.
- **Try limits** (`reserveTry`, `reserveSessionTry`, `apps/server/src/auth.ts`). Counts over the last 15 minutes:
  - **per address:** after five wrong tries, further tries from that address are refused until the oldest of them is
    15 minutes old ("Too many tries. Wait 15 minutes.", with `Retry-After`). This always applies, to every door;
  - **per name**, only for a device that has never signed in to that account: five tries free, then a growing wait
    after the latest one: 1 s, 2 s, 4 s, ... at most 30 s ("Too many tries for this name. Wait N seconds."). A refused
    try is not stored, so a stranger with enough addresses can take every opening the moment it comes and keep the name
    waiting almost all the time. That is why **a known device skips the name wait** (`knownDevice`): the owner's own
    browser or app is held only by its per-address limit, so the stranger's guesses cannot keep them out. A device is
    known by the install's random id the app sends at sign-in (`deviceId`), found in the account's activity-log notes
    (`account_events.device_id`, never shown) or a live session, or by a long-lived cookie (`somnium_device`, HttpOnly,
    SameSite=Strict, path `/api/auth`, 400 days) the server sets at every successful sign-in: a random nonce with an
    HMAC of it and the account id under the server's key, so it names one account, cannot be forged without the key,
    and holds nothing personal. The cookie covers the doors that send no `deviceId` (recovery key, reset code). No
    address is ever stored for this: "known" is a property of the device, not of where it is;
  - **per session**, for the checks made inside a session (the password asked again, a key proof, a two-factor code at
    `/2fa/disable`): five wrong tries, then refused until the oldest is 15 minutes old. The name wait never applies
    there, so guesses at your name on the sign-in screen cannot lock you out of your own settings.

  The address and name counts cover wrong passwords, wrong two-factor codes at sign-in, wrong reset codes and wrong
  recovery keys; the address and session counts cover wrong key proofs and the password asked again for sensitive actions. A burst sent at the same moment cannot all pass: each try
  is reserved before the slow hash, in one transaction holding a lock per key, and only a right answer takes it back.
  The tries are kept in the database (table `sign_in_tries`, key and time, migration `013_sign_in_tries`), so a
  restart does not clear them; rows older than 15 minutes are pruned on every try, and a name is cut to 64 characters.
  Like the other sign-in tables it is not granted to the app role. Nothing is deleted by wrong tries.
- Every sign-in from a **new device** posts a note to the account's activity log (Settings → Security), once per device,
  as do password, two-factor, recovery-key and admin actions.
- **Admin** (`/api/admin/*`) can list accounts, make invites, switch registration, disable or delete accounts, make a
  one-time reset code, and turn two-factor off for someone. An admin cannot read a journal, and cannot demote or
  disable themselves. Admin routes need an admin session.
- Deleting your own account needs the password; the last admin cannot do it.

## The app lock

Nothing of the journal shows until the person proves it is them (PLAN.md §4.3). The decisions are in one tested
function (`packages/shared/src/lock.ts`); `apps/web/src/core/lock.ts` feeds it the real events.

- **When it locks:** on every start, reloads included; when the tab or app is hidden (and, in the desktop app, when the
  window loses focus) for longer than the chosen delay (immediately by default; 30 s, 1, 5 or 15 minutes); after idle
  time (10 minutes by default; 5, 15 or 30 minutes). **It cannot be turned off**, and a saved value that is not one of
  the choices falls back to the default.
- **What locking does:** the data key is zeroed and dropped from memory, the shells and pages are unmounted so no dream
  is in the page, the query cache with its decrypted answers is emptied, open questions are dismissed, toasts are
  dropped, and a question or toast raised later stays away until the next unlock. A session ending does all of this
  too. A form with unsaved text is lost with its page.
- **What can remain for a moment:** work that seals or opens rows uses its own copy of the key, one step at a time (a
  batch in a sync, the first copy's rows, a file, a request's body, the slow re-wrap when the password changes). A step
  already running finishes with its copy, because zeroing it midway would seal rows with zeros; the copy is zeroed as
  the step ends and no further step starts. So the key can stay in memory for as long as one step takes, usually under
  a second, a few seconds with a big first copy or a slow derivation. Sealing a request's body can include a lookup from
  the server, up to 20 seconds at worst. Text a step has opened stays in JavaScript's memory until collected (strings
  cannot be zeroed). A request already sent cannot be recalled, but its answer is not opened. The password itself and
  Web Crypto's internal copies of keys cannot be zeroed either.
- **System dialogs:** a file picker, the camera or the device's verification takes the app out of sight without the
  person leaving, so they hold the lock back, for two minutes at most.
- **Unlocking with the password:** the bundle (salt and wrapped key) is asked of the server when it answers, because the
  password may have changed elsewhere, and otherwise comes from a copy on the device made at sign-in. A successful
  unwrap is the proof, with no round trip needed. With no connection, the password that was current at the last
  contact is the one that works.
- **Wrong tries cost time and nothing else.** A wrong password never deletes anything or signs anyone out. After five
  wrong tries in a row each further try waits: 1 minute, then 5, then 15, then 1 hour for every try after that. The
  journal stays locked, the screen shows a countdown, and a try during a wait is refused before the password is looked
  at. The right password starts the count over. Device verification follows the same count when it answers with
  something that does not open the key; a cancelled verification or a missing connection never counts. The count and
  the time of the last try are stored on the device, so reloading or restarting does not skip the wait. A clock moved
  back counts as still waiting: the whole wait starts over from then.
- **The limits of that wait:** it slows down someone using the app's own lock screen. It runs on the device, so moving
  the clock forward shortens it and clearing the browser's data resets it. Anyone able to do that already has the
  browser profile, which holds the plaintext copy and the wrapped key that could be attacked directly; only the
  password's strength and Argon2id stand against that.
- **Signing out** is a choice on the lock screen, and it deletes this device's copy. If changes have not reached the
  server, it says so first.
- **Two people on one browser:** when someone else signs in, the earlier person's copy is deleted only if it holds
  nothing unsent. A copy with unsent changes, or one the device cannot vouch for, is kept, closed, with its queued
  changes, and they are sent when that person next signs in and unlocks. Nothing of it is shown or sent under another
  session (`packages/shared/src/copyOwner.ts`). The limit: the kept copy stays on that device, in plaintext, and if that
  person never comes back it stays there; anyone with the browser profile can read it with developer tools. Removing it
  takes signing in as its owner and signing out, or clearing the browser's data (which loses the unsent changes).
- **When a session ends without signing out** (it expired, or was ended elsewhere), the tab leaves the device's copy at
  once and goes back to the server, and the copy stays closed for the same person's return; for someone else it goes
  only if it holds nothing unsent, as above. Another tab that sees the session change reloads. Signing out also reloads
  the page when it used the copy, because PGlite holds its IndexedDB connection for the life of the page and the
  deletion can only finish once the page lets go. If another tab still holds it, it stays on disk until that tab
  reloads or closes.

### Per platform

**Web and PWA: a screen lock with the key in memory.** Unlocking uses the password, or a **WebAuthn platform
authenticator with the PRF extension** (Windows Hello, Touch ID, Android's screen lock in Chrome): after the
fingerprint, face or screen lock the authenticator gives 32 secret bytes that wrap the data key, and only the wrapped
blob is stored on the device, under that person's id, never offered to anyone else and removed when someone else signs
in. WebAuthn **without PRF cannot release a key**: it confirms presence and nothing more, and the journal could be
opened only if the key were stored unprotected, which it never is. On such a device the person is told and uses the
password. "Use password instead" is always there.

**Android: Keystore** (`SomniumLockPlugin.java`). The data key is wrapped by an AES-256-GCM key in the Android Keystore
made with `setUserAuthenticationRequired(true)`. On Android 11 and newer every use needs the fingerprint, face or screen
lock, carried by a `CryptoObject` through BiometricPrompt (BIOMETRIC_STRONG or DEVICE_CREDENTIAL in one window). On
Android 6 to 10 a Keystore key cannot take the screen lock that way, so it works for 15 seconds after a strong biometric
or the phone's confirm-your-PIN screen. Below Android 6 there is no such key and the app unlocks with the password. The
wrapped blob is kept in the account's record in the app, never in shared preferences. The data key passes through Java
only inside the wrap and unwrap calls and is zeroed there (the base64 text the bridge carries cannot be zeroed). A
cancelled prompt never counts as a wrong try; a blob that does not open counts like a wrong password. A new fingerprint
or a removed screen lock ends the Keystore key: the blob is dropped and the password is the way in until device
verification is turned on again. Signing out forgets the blob and the Keystore key. `FLAG_SECURE` is on by default
(blank recents thumbnail, no screenshots or recording), with a setting in Settings → Security to allow screenshots.
Leaving the app is reported once it is out of sight (`onStop`), timed from `onPause`, so the lock's delay counts from the
moment the app began to leave, while a permission dialog or the app's own prompt (which only pause it) does not lock it.
A local account opens with the phone's verification too, and "Set a new password" re-wraps its record from the key the
prompt released, after checking it is the open journal's key. Before Android 11 the Keystore key cannot be tied to each single use: after the fingerprint or screen lock it stays usable for 15 seconds, so anything running in the app in that window could use it. From Android 11 every unwrap needs its own verification.

**Desktop: password only, no OS prompt, no device key.** The desktop app unlocks with the password and holds no device
key (LDJ-10, decided). WebAuthn refuses its `http://127.0.0.1` address, and Electron's `safeStorage` asks for nothing: it
decrypts for anyone using the signed-in computer, and on Linux may have no real keyring behind it. Keeping the data key
in it would make the lock screen's button open the journal for whoever clicks it, and a "device key" there would let
anyone at the computer set a new password. Settings → Security says so. The window's content protection is on by
default (a request to the system on Windows and macOS that capture tools may ignore; it does nothing on Linux, where the
setting is not shown). The window runs with `contextIsolation` on and opens links in the system browser.

### The honest limits

- On the web the lock is real for the key: it is gone from memory, and only the password or the authenticator brings it
  back. But a script running in the page (a malicious extension, a compromised server handing out bad code) sees
  whatever the page sees while unlocked, and can capture the password as it is typed.
- The copy of the journal in the browser's storage is plaintext and is **not encrypted by the lock**. Anyone with the
  unlocked browser profile can read it with developer tools, without touching the lock screen. The lock protects against
  someone picking up the open app, not against someone with the profile.
- The bundle and the wrong-try count live in the browser's storage. Someone with the profile can copy the bundle and
  guess passwords offline, limited only by Argon2id, or reset the count. A signed-in session can ask the server for the
  bundle too, and gets what sign-in itself hands over.
- A hidden tab's timers are slowed by the browser, so with a delay other than "immediately" the key can stay in memory up
  to about a minute longer than chosen. Coming back always checks the time. JavaScript cannot guarantee that no copy of a
  key or decrypted text is left in memory until overwritten.
- An operating system may keep a picture of the app for its task switcher, taken before the app learns it was hidden.
  The web cannot prevent that; Android's `FLAG_SECURE` and the desktop's content protection can.
- **A local account's lock** works like a server account's: the password opens the data key from the account's own
  record, a forgotten password is replaced with the recovery key (which is then replaced too), wrong passwords and wrong
  recovery keys wait 1, 5, 15 and 60 minutes after five, and nothing is ever deleted. The record and the count are on
  the device, so someone with a copy of the app's storage can guess passwords offline, limited only by Argon2id, or
  reset the count. In the desktop app the count and the lock's settings are kept in the account's record in
  `accounts.json`, not in the browser storage of its address, which would start over if the address changed. The address
  stays the same (`127.0.0.1` on a port kept in the record); only if something else has taken that port does the account
  move to another one. A first password is offered only when the account has no record at all: a record that cannot be
  read or is not in the expected shape is never replaced, because it may hold the only wrapped copy of the data key. The
  lock screen says so and offers the recovery key, which opens the journal from the record's recovery part.

## Getting back in

| You lost | The way back |
|---|---|
| The password, and you have the recovery key | Sign-in or lock screen → Forgot password → recovery key → new password; a new recovery key is shown |
| The password, and a phone is still signed in with device verification on | Settings → Security → Set a new password on the phone, without the old one (device key, below) |
| The password and nothing else | An admin makes a reset code. You can sign in again but **the journal stays sealed** until the recovery key is entered |
| The authenticator | A backup code, or the admin turns two-factor off |
| The recovery key | Make a new one in Settings → Security (needs the password) |

Settings → Security shows a "Can you get back in?" checklist (recovery key saved, another device signed in, backup
codes saved, automatic backups on).

### The recovery key

Made on the device in Settings → Security (or straight after sign-up), from the open data key, and shown once: 20
characters from 31 unambiguous ones (no 0/O, 1/I/L), in 5 groups of 4, about 99 bits (Money Manager's format). Argon2id
over it gives two HKDF keys: one wraps the data key and never leaves the device; the other, the verifier, goes to the
server and is kept only as a scrypt hash. The server holds the salt, the wrapped key and that hash, so it cannot open
the journal with what it has. Making a new key ends the old one, and so does using it.

**Forgot password:** the device asks `/api/auth/recovery/salt` (an unknown name, or an account without a key, gets a
stand-in salt that is the same every time), derives the verifier and sends it to `/api/auth/recovery/open`. Only a right
verifier gets the wrapped data key back; a wrong key, an unknown name and a missing key get the same answer, and every
try counts against the same limit as signing in. The device opens the data key, re-wraps it under a new password and
makes a new recovery key; `/api/auth/recovery/finish` checks the verifier again and swaps password and recovery key in one
statement bound to the old verifier, so a key works once even when two requests race. With two-factor on, an
authenticator or backup code is needed too. Every other session ends and the activity log notes it.

**The limit:** `/api/auth/recovery/open` hands back the wrapped data key before any second factor is asked for, so a
stolen recovery key opens any sealed copy of the journal (a dump of the server, a sealed export or a backup) even with
two-factor sign-in on. Two-factor still guards the next step: setting a new password and signing in with it.

### After an admin reset

An admin (admin panel, or `cli.ts reset-password <username>` on the server) makes a **one-time reset code, valid for one
day**, which signs the person out everywhere. Using it (sign-in screen → Forgot password → "I have a reset code") sets a
new password, switches two-factor off and deletes its backup codes. The password no longer wraps the data key, so **the
journal is sealed** until the recovery key is entered on the lock screen, which comes straight after signing in. That
screen asks for the password just signed in with (sent as `current` and checked before anything is stored, so a typo is
refused instead of quietly becoming the new password).

A device that held the key does not survive a reset, by design: the reset signs it out, and signing out forgets the key,
so a phone signed out after a loss does not keep a way in. The reset message therefore promises only the recovery key.
On the server, `cli.ts disable-2fa <username>` turns two-factor off for someone who lost the authenticator and codes.

### Device keys (phone only), and their limits

A phone signed in with device verification on can set a new password without the old one. The server never sees the
data key; the phone proves it holds it with a **key proof**: a one-way HKDF value made from the data key (`keyProof` in
`@somnium/shared`), the same on every device of the account and useless for opening anything. The server keeps only its
scrypt hash (`users.key_proof_hash`), and registers it only while the password (or the recovery key) is proven: at
sign-up, right after each sign-in (`/auth/key-proof` with the authKey just sent; the first proof stays and a different
one is refused), or with the recovery key. A stolen session token alone cannot register a proof of its own choosing.

`/auth/password/device` then needs all of: the current session; that session having registered a device key with the
proof (`sessions.holds_key`, a plain flag, shown as "holds your key" in the devices list); the proof itself, checked like
a password (a wrong one counts against the same limit); and, with two-factor on, an authenticator or backup code. The
phone's prompt releases the key first, so the phone verifies the person. Other devices are signed out.

Limits: the desktop has no device key (above), so this works from a phone only. A device key does not outlive its
session: signing out, or a reset, forgets it. An account signed in before device keys existed registers its proof on its
next sign-in; until then device verification still unlocks the phone, and the server says it needs one sign-in with the
password first.

## Backups and exports

- A **backup** (`.somniumbackup`, `packages/engine/src/sync/backupFile.ts`, `apps/web/src/core/backup.ts`) is JSON: the
  journal **sealed exactly as on the server** plus the account's wrapped data key, so it opens with the password the
  account had when it was made or with its recovery key, and nothing else. What is readable without a key is what the
  server itself can read (dates, times, ratings, marks, the settings, the user name). An optional **passphrase** wraps the
  whole file once more (Argon2id, AES-256-GCM), which hides those too.
- Making one needs the journal open, so automatic backups run while the app is unlocked: the desktop app writes to a
  folder (Documents/Somnium Backups by default), the Android app to Documents/Somnium, a Chromium browser into a folder
  picked once; any other browser offers a download. They are logged on the device (time, size, where). A backup you restore into an account on a server moves the account there.
- A **plain export** (JSON, Markdown, CSV) is **plaintext, readable by anyone who has the file**.
  See "Exports" above for how that arises. Keep exported files like the journal itself.
- A backup holds the journal tables, the settings and the account's wrapped keys; it has no session, no server key and no two-factor secrets. The server's own
  database and `appdata` volume are backed up by you, with your usual server backup: the key file `/data/app.key` is
  needed to read two-factor secrets after a restore, and without it people must set two-factor up again.
- A backup opens with the password the account had **when it was made**, even after that password is changed. After
  changing a password because someone else may know it, delete the older backups.
- On Android, backups go to Documents/Somnium, which is **shared storage**: other apps with file access, a computer
  over USB and any cloud sync of Documents can read the files. They are sealed, so they still need the password,
  recovery key or passphrase. The app deletes only its own backups (its file name pattern plus its format inside), one
  account at a time.
- Docker's `/data/media` holds the sealed files, mode 600, a folder per account.

## Reminders and notifications

- Reality-check, bedtime, WBTB alarm, morning journal and practice reminders are worked out on the device
  (`packages/shared/src/reminders.ts`). Their words are generic: the question, the check's own name and how-to, the
  technique as an id from a fixed list. **Never dream text, never anything
  sealed** (a bedtime reminder never says your intention).
- **One exception, off by default:** "Show my dream sign in reminders". When it is on, the top dream sign's name (which is
  sealed) is read while the journal is unlocked, never while locked, and put in the text ("Watch for ..."). Those texts
  stay planned after the app locks: in the page's timers, in the desktop app's main process, and on Android in the app's
  own storage (`somnium_reminders`), until shown or replaced. **On the desktop and the web, the notification shows the
  name over the lock screen**, as the system draws it. **On Android** the lock-screen version is the public one, just
  "Reality check" or "Bedtime", the full text appears only once the phone is unlocked (`VISIBILITY_PRIVATE`). Leave the
  switch off to keep every reminder free of anything from the journal.
- On Android the alarms are exact alarms kept in the app's storage and set again after a restart without the web app, the
  network or the journal's key. The Awake / Not sure / Dreaming buttons on a reality-check notification log the check with
  no note and nothing sealed. The WBTB alarm is a real alarm with its own channel and rings up to 10 minutes. Without the
  exact-alarm permission they may come a little late, never not at all.
- The desktop app keeps reminders in the page and the main process; it does not yet stay in the tray after the window
  closes (planned, LDJ-56).

## The network

- **Who talks to whom.** The app talks to your own server (the page and `/api`, plus a live-update stream per signed-in
  person, `/api/events`). Nothing else leaves the device except the **update check**: GitHub's public "latest release"
  list, asked by the server (`apps/server/src/version.ts`, which the web app asks through `/api/update-check`), by the
  Android app for a local account (`core/releases.ts`), and by the desktop auto-updater, sending no identifier. All analysis (lexicons, `compromise`, `tesseract.js`) runs on
  the device; fonts are bundled; there are no analytics, telemetry or error reporting. A server account's browser
  talks to your server only; the server talks to the database and, for the update check, GitHub.
- **Docker.** The `db` container (PostgreSQL 16) is only on an **internal** network (`backend`, `internal: true`): it has
  no route out and nothing outside can reach it. Only the `app` container is on the second network (`web`) and the port
  is published on `127.0.0.1` only (`SOMNIUM_PORT`, default 8800). Put a reverse proxy with HTTPS in front
  (docs/self-hosting.md); do not expose the port to the open internet. Inside the container the server listens on all
  interfaces (`HOST`, default `0.0.0.0`), which is why the published port is bound to `127.0.0.1`.
- **Row-level security.** Every request runs in a database transaction as the role `somnium_app` with `app.user_id` set to
  the signed-in person (`withUser`, `packages/engine/src/db.ts`), so even a query that forgets `WHERE user_id = ...`
  cannot see or change another person's rows. The sign-in tables (`sessions`, `invites`, `app_meta`, `sign_in_tries`) are not granted to
  that role at all. Every user table has `user_id` and a policy.
- **Cookies and headers.** As in "Sign-in" (HttpOnly, SameSite=Strict, Secure over HTTPS, the `X-Somnium` header on
  changes). Uploaded files are served only to their owner, from a path made from the session and the id, never from
  the row's path column.
- **Security headers** (`apps/server/src/headers.ts`), on every answer the server gives, files, API and errors alike,
  from one `onSend` hook:
  - `Content-Security-Policy`:
    `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'sha256-...'; style-src 'self' 'sha256-...';
    style-src-attr 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; font-src 'self';
    connect-src 'self'; worker-src 'self' blob:; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none';
    form-action 'self'; object-src 'none'`.
    The hashes are those of `index.html`'s inline pre-paint script and splash style, read from the built file (again
    whenever it changes), never typed in. `'wasm-unsafe-eval'` lets the device database (PGlite) and the photo text
    reader (tesseract.js) compile WebAssembly; it does not allow `eval` or `new Function`. Style attributes are
    allowed (`style-src-attr`, which Vue's static templates need); style sheets and `<style>` elements are not, unless
    bundled or hashed. `connect-src` is the server only: the update check goes through it, so a script that got in
    cannot call out.
  - `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy: same-origin`,
    `X-Content-Type-Options: nosniff` (an uploaded file can never be run as a page or script), and
    `Permissions-Policy: camera=(self), microphone=(self)` with the other powerful features (location, payment, USB,
    serial, HID, MIDI, screen capture, motion sensors, topics) turned off.
  - **Desktop:** a local account's screens come from the same server code, so the same headers; a server account's
    come from the app's own proxy, which adds them to every file it serves (`apps/desktop/src/main.ts`).
  - **Android:** the files come from the app bundle, so the policy is a `<meta>` tag written into `index.html` by
    `apps/android/prepare-web.mjs`, with the hashes taken from the built file there. It differs in two places:
    `connect-src` also allows `https:` and `http:` (your server can be at any address; most requests go through the
    native side, which the policy does not see), and there is no `frame-ancestors` (a `<meta>` policy can't carry it).
  - **Development:** the Vite dev server sends a looser policy (inline scripts and styles, websockets) so hot reload
    works (`apps/web/vite.config.ts`); the strict one is on the built app.
- **Behind a proxy.** The try limits count by the client's address, so who may name that address matters. The server
  trusts `X-Forwarded-For` / `X-Forwarded-Proto` from **one hop** by default: the reverse proxy right in front, so the
  client is the rightmost address the proxy added, and anything the client wrote in front of it is ignored. A proxy
  that appends to the header (Caddy, nginx with `$proxy_add_x_forwarded_for`) therefore cannot be used to pick an
  address. `TRUST_PROXY` changes it: unset or `1` one hop; a number, that many hops (a CDN in front of your proxy:
  `2`); a comma-separated list of proxy addresses or CIDR ranges (`127.0.0.1,10.0.0.0/8`); `0` none, when the server
  faces the network itself (then use the socket address; not recommended, the server does not do HTTPS). `true`
  (trust every hop) is never used: it is read as one hop. Tested in `apps/server/test/auth.test.ts`.
- **Uploaded files are served with a fixed set of types.** The stored type of a media file comes from the client, so it
  is never echoed back as sent: `image/jpeg`, `image/png`, `image/webp`, `audio/webm`, `audio/ogg` and `audio/mp4` are
  served as such (parameters dropped), anything else as `application/octet-stream`, checked on upload and again on
  every download (sync can write the column too). With `nosniff` on every answer, no upload can be run as a page.
- **The security headers never fail an answer.** `index.html` is looked at for new hashes at most once a second (by
  time and size); a file that is missing or being rewritten keeps the last good policy, and nothing in that hook can
  throw.
- **The desktop app** runs its own local server on `127.0.0.1` for a local account, one port per account, and opens
  links in the system browser. Server accounts reach their server through the app.
- **The service worker** caches the app's own built files and, once seen, photos (sealed). It never caches `/api` data.

## Not covered

- **A device that is unlocked, or that someone with the browser profile or the app's storage can read.** The device copy
  of a server account is plaintext; the app lock is not encryption.
- **A compromised device or a script in the page** (a malicious browser extension, a hostile server serving bad code
  to a web user) sees what the page sees while it is unlocked and can capture the password as it is typed.
- **The server admin, or anyone with the database, can see the plain columns** (when you logged, how you rated), the
  usernames, how many nights and dreams exist, how large each file is, and when a device signed in. They cannot read
  content, but they can delete or inject rows (see "Limits we accept").
- **A stolen recovery key** opens any sealed copy of the journal even with two-factor on (see above).
- **Many addresses against one name.** The per-name wait slows such guessing to about one try per 30 seconds; it does
  not stop it. A strong password is what makes it hopeless (10+ characters, not on the common list).
- **Memory.** Strings and Web Crypto's key copies cannot be zeroed; the key can linger for the length of one step after
  locking.
- **Lost password, lost recovery key, no signed-in phone:** gone for good.
- **Plain exports and backups with no passphrase** are only as safe as where you put them. A backup holds the sealed
  journal, but its dates and ratings are readable.
- **Task-switcher thumbnails on the web**, and screenshots anywhere content protection does not apply (desktop Linux).
- **Disk, SSD and storage remnants** after a local account was converted or deleted.
- **A phone with no strong biometric or screen lock** has no device key; the password is the way in.
- **The desktop app has no OS prompt** to unlock: whoever knows the password, or sits at an unlocked computer after the
  lock delay has not yet passed, is in.

## How this is tested

Run `./scripts/pnpm.sh -r test`. The tests that carry the claims above:

| What | Where |
|---|---|
| **Isolation: B cannot reach A, on every route and through raw SQL.** Asks every route the engine registers (read from its modules) as another person, then raw SQL under the app role: `SELECT *` on every readable table, `UPDATE`, `DELETE`, `INSERT` as someone else, no person set, the closed sign-in tables, RLS on and a policy on every table with `user_id` | `packages/engine/test/isolation.test.ts`; also "keeps one person's rows from another" in `packages/engine/test/engine.test.ts` |
| Isolation of files and sessions: a file is served to its owner only; a push from one person's copy under another session is refused | `apps/server/test/media.test.ts`, `apps/server/test/copy-owner.test.ts`, `packages/shared/src/copyOwner.test.ts` |
| **Sealing: the server dump holds no plaintext.** A dream, night, element, check, practice entry and lesson answers written through a device with distinctive strings, every table dumped as the database admin, none appears; a second device opens them; plaintext is refused by every path | `packages/engine/test/sealing.test.ts` |
| Sealing of files: no marker from a photo in the database dump or any file under the media folder; unsealed files refused | `apps/server/test/media.test.ts` |
| Sealing of a local account at rest: a database on disk with no plaintext in any byte, an old account sealed in place | `packages/engine/test/local-at-rest.test.ts` |
| **Crypto: wrap, unwrap, password change, recovery.** Argon2id and HKDF key separation, envelopes, wrong key and tampered byte refused, wrap by password, recovery key and device key, password change re-wraps the same data key, NFC, constant-time compare | `packages/shared/src/crypto/crypto.test.ts` |
| Crypto for local accounts: round trip, password change, recovery with a new key, damaged record | `packages/shared/src/crypto/localAccount.test.ts` |
| Crypto against the server: sign-up and sign-in with the authKey, two-factor and backup codes, the wait after wrong tries, password change, admin reset, the server's key | `apps/server/test/auth.test.ts`, `apps/server/test/account.test.ts` |
| **Try limits in the database**: they survive a restart (a new server on the same database), an address gets five in all, a name slows down (1, 2, 4 ... 30 s) for unknown devices but its owner signs in from a known device however many addresses poll it, and session checks never wait on the name; a forged leftmost `X-Forwarded-For` does not change the counted address; **security headers** with the hashes of `index.html` on every answer | `apps/server/test/auth.test.ts` |
| Recovery flow on the server: the verifier hashed, the same answer for unknown names, the shared limit, one use under a race, two-factor, opening again after an admin reset | `apps/server/test/recovery.test.ts` |
| Device keys: proof registration, new password without the old, wrong proof counted, two-factor still asked | `apps/server/test/device-key.test.ts` |
| Backups: sealed, opens with password or recovery key, passphrase wrap, merge and replace | `packages/engine/test/backup.test.ts` |
| **The lock state machine**: start, hide, delay, idle, clock going backwards, system-dialog holds, wrong-try waits (1, 5, 15, 60), no deleting, the Keystore / WebAuthn / password choice | `packages/shared/src/lock.test.ts` |
| **Locked reads**: every route the engine registers is asked with the key closed; nothing let through answers anything of the journal; the paths are refused however written | `packages/engine/test/locked-reads.test.ts`, plus "a device without the key sends nothing and takes nothing" in `packages/engine/test/sealing.test.ts` |
| Password rules | `packages/shared/src/password.test.ts` |

What has no automatic test: the Android Keystore and BiometricPrompt code, WebAuthn PRF, Electron, and a real browser's
storage (no browsers are run in tests). Those are checked by hand.
