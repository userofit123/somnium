# Somnium - Lucid dreaming journal and trainer: Master plan

Somnium (Latin: "a dream") is a self-hosted, private-first journal and trainer for lucid dreaming. It follows the
Money Manager → Motus line: the same theme engine, settings, installed-app bars, updates, backups, dev setup and
release pipeline, and Motus's engine/server/web/desktop/android layout. This plan is the single source of design
decisions; RESEARCH.md is the evidence it rests on and the raw material of the in-app knowledge base.

## Table of contents

0. Requirements
1. Name and terminology
2. Platforms and architecture
3. Tech stack
4. Security and privacy (the sealed journal)
5. Data model
6. Screens and features
7. Dream analysis (dream signs, elements, recall and lucidity insights)
8. Training, techniques and the recommendation engine
9. Reminders and notifications
10. Knowledge base (Learn)
11. Design system and appearance
12. Backup, restore, export and import
13. Apps, updates and releases
14. Self-hosting and development
15. Delivery phases and task list
16. Decisions log

---

## 0. Requirements

Goals, from the brief:

1. A modern, minimalist, clean app for keeping a dream journal and getting better at lucid dreaming.
2. Tools that train lucid dreaming, teach it, and a dream journal at the centre.
3. The journal lets the person mark common elements (characters, places, objects, actions, emotions, themes), and the
   app also finds them itself from the text (and from photos of handwritten pages through on-device OCR), the way
   Immich finds things in photos: grouped, counted, searchable.
4. Analysis of the dreams: recurring dream signs, elements and signals, ranked, so the person can recognise them and
   become lucid.
5. Extremely secure and private: the journal is sealed (end-to-end encrypted), every install requires the password
   (or the device's own verification) to show anything, also when coming back from another app; two-factor sign-in;
   a recovery key; and always a way back in.
6. Reminders and notifications to check whether you are dreaming through the day, from the person's own settings
   and from recommended ones.
7. Recommendations that follow the evidence (what actually raises lucid-dream frequency), from the person's own
   journal data.
8. A built-in knowledge base: history, science, techniques, traditions, tools, people's experiences, safety.
9. Everything that the research shows helps (RESEARCH.md) is in the app, even when the brief did not name it.
10. Self-hosted, same install options as Money Manager and Motus: Docker server, web / PWA, Windows and Linux
    desktop apps, Android APK; automatic backups; in-app updates. English only for now.
11. Nothing personal in the repository (GitHub user name only), public repo, no release before 0.1.0 is done.

## 1. Name and terminology

- **Somnium** (Latin, "a dream"; same naming idea as Motus). Repo `userofit123/somnium`, packages `@somnium/*`,
  Android id `org.somnium.app`, dev site https://somnium.local, storage keys `somnium*`, backups `*.somniumbackup`.
- Words in the UI: **dream** (one entry), **journal**, **night** (a sleep period; a night can hold several dreams),
  **dream sign** (something that recurs in your dreams and is odd enough to tip you off), **element** (a tagged
  character / place / object / action / emotion / theme), **lucid** (you knew you were dreaming), **reality check**
  (a test, done awake, of whether you are dreaming), **technique** (MILD, WBTB, SSILD, WILD, ...), **practice**
  (what you did for lucidity today or tonight), **lesson** (a step of the training course). Plain words everywhere;
  the Learn section has a glossary.

## 2. Platforms and architecture

Motus's architecture, kept as is (Motus PLAN.md §2 applies unless changed here):

- `packages/engine`: all data logic, SQL migrations, row-level security, sync. Runs on PostgreSQL (server) and
  PGlite (device replica, local accounts, tests).
- `packages/shared`: types, pure logic (analysis lexicons and scoring, scheduling maths, settings, features).
- `packages/knowledge`: the Learn content (Markdown with sources) and the lexicons, bundled into every app.
- `apps/server`: Fastify around the engine: sign-in, sessions, 2FA, recovery, admin, SSE, sealed blobs, media.
- `apps/web`: Vue 3 + TypeScript; desktop shell (rail) and phone shell (tabs) sharing pages; PWA.
- `apps/desktop`: Electron (local accounts run the engine inside; server accounts over HTTPS).
- `apps/android`: Capacitor (local accounts on PGlite inside the app; server accounts over HTTPS).
- **Local accounts and server accounts** side by side on one device, as in Motus §2.4: an account is either
  **on this device** (everything stays local, no server at all) or **on a server** (your own Somnium server).
  Settings → **Servers & accounts** lists every server with a name you gave it, lets you add, rename and remove
  servers and switch between them and your local account; the switcher is also at the bottom of the desktop rail
  and at the top of the phone's More page.
- **Fully offline**: with no internet the app opens and works exactly as normal (write, search, analyse, train,
  reminders) - server accounts work on a device replica (PGlite) and sync both ways as soon as the server can be
  reached again, with the newest change to a row winning; local accounts are
  always local. This matters more here than in Motus: with the sealed journal (§4) the server holds only
  ciphertext, so all reading, searching and analysis happen on the device's replica anyway.

## 3. Tech stack

Same as Motus §3: Vue 3.5 + Vite, TypeScript strict, Fastify, PostgreSQL 16 / PGlite, numbered SQL migrations,
SSE live updates, scrypt/argon2id, Vitest, Playwright, pnpm monorepo. Additions for Somnium:

| Need | Choice |
|---|---|
| Encryption | WebCrypto AES-256-GCM; Argon2id via `hash-wasm` (same code in browser, Electron, Android, Node) |
| On-device OCR of journal photos | `tesseract.js` (WASM, English model bundled, lazy-loaded; no network) |
| Text analysis | `compromise` (nouns, people, places, verbs; ~300 kB, lazy-loaded) + our own lexicons in `packages/knowledge` |
| Charts | Motus's SVG LineChart / BarChart / Sparkline / Ring |
| Audio notes | MediaRecorder (webm/opus), stored sealed as media; no transcription service |
| Speech to text (optional) | The browser's / Android's own Web Speech API, when present, never a cloud key of ours |
| Reminders | Android: `@capacitor/local-notifications` with exact alarms; web: Notification API + service worker periodic scheduling; desktop: Electron notifications + a timer in the main process |
| Device verification | Android: BiometricPrompt (biometric or screen lock) through a small plugin like Money Manager's AppLock; web and desktop: WebAuthn platform authenticator (Windows Hello, Touch ID, Android screen lock) with the password as the fallback |

## 4. Security and privacy (the sealed journal)

Dreams are among the most private things a person writes down. The design is **the server never reads them**.

### 4.1 The sealed journal (end-to-end encryption)

- Each account has a random 256-bit **data key**. Everything personal in the journal (dream text, titles, notes,
  element labels, voice notes, photos, OCR text, reality-check notes, free-text settings) is encrypted on the
  device with AES-256-GCM under the data key before it goes anywhere. The server and its database hold ciphertext
  in those columns ("sealed columns", listed per table in `packages/engine/src/sealed.ts`) and never query them.
  Dates, counts and ratings (lucidity level, sleep times) stay plain so the server can order and page rows, and
  because they say nothing on their own; the list of plain columns is deliberate and documented in `sealed.ts`.
- **Key wrapping (envelope):** the data key is stored wrapped (AES-KW / AES-GCM) by
  1. the **password key**: Argon2id(password, account salt) → HKDF → `encKey` (wraps the data key) and `authKey`
     (what the server verifies, stored as a scrypt hash). The server never sees the password itself, only
     `authKey`, from which `encKey` cannot be derived. (Bitwarden's model; see RESEARCH.md for the reference.)
  2. the **recovery key** (20 characters from 31 unambiguous ones, Money Manager's format): Argon2id(recovery key,
     salt) wraps the same data key. Shown once; only its slow hash and the wrapped key are kept.
  3. **this device** (apps only): the data key wrapped by a key in the Android Keystore (user-authentication
     bound) or Electron `safeStorage`, so the app can unlock with the device's fingerprint / face / screen lock
     without the password, and so a signed-in device can set a new password when the old one is forgotten (§4.4).
- **Local accounts** use the same envelope, kept in the account's own record on the device; the data key is wrapped by
  the password, the recovery key and (LDJ-9/10) the device. Their database is sealed at rest like a server's: the app
  seals the sealed columns before the local engine stores them and opens them on the way back (LDJ-53, docs/security.md).
- Changing the password re-wraps the data key (no re-encryption of data). Making a new recovery key re-wraps too.
- The device replica (PGlite in IndexedDB / the app's storage) holds plaintext so the app can search and analyse
  offline; it is protected by the device and by the app lock (§4.3). On sign-out the replica is deleted.
- **What this means honestly** (shown in Settings → Security and in docs/security.md): if the password AND the
  recovery key are lost AND no signed-in device remains, the journal cannot be read by anyone, including the
  server admin. An admin can reset the sign-in password, but the data stays sealed until the recovery key or a
  signed-in device re-wraps it.

### 4.2 Sign-in

As Motus §4.1-4.4 (multi-user server, first account is admin, invites, sessions as hashed random tokens, HttpOnly
SameSite=Strict cookie on the web and bearer tokens in the apps, signed-in device list, rate limits with backoff,
zod validation, strict CSP, self-hosted fonts, EXIF stripped from photos), plus:

- **Two-factor sign-in (TOTP)**, any authenticator app, with **eight one-time backup codes** shown when it is
  turned on (stored hashed). Admin can turn 2FA off for a user who lost both (CLI and admin panel).
- Password rules: 10+ characters, checked against a bundled list of the 10,000 most common passwords.
- Every sign-in from a new device posts a note in the account's activity log (visible in Settings → Security).

### 4.3 App lock (every install)

Required by the brief: nothing is shown until the person has proven it is them, on every platform, also when
coming back from another app.

- **When it locks:** on every start (except a browser reload within the delay, below); when the app goes to the
  background / loses focus / the tab is hidden for longer than the chosen delay (default **10 minutes**; choices:
  immediately, 30 s, 1 min, 5 min, 10 min, 15 min), checked once a second while away and again on coming back; after
  10 minutes idle (its own setting). Closing the desktop app to the tray locks at once whatever the delay (LDJ-56).
  A saved "immediately" from before 2026-11-15 moves to 10 minutes (it was the default and was saved along with any
  change to the idle time, so a choice can't be told from it); "immediately" chosen since is kept (D11).
- **Reload grace (browser and PWA only):** a tab that reloads, or that the browser discarded in the background, opens
  again without the lock screen if it comes back within the delay, for the same account. The data key is never
  stored in the clear: while the journal is open it is kept encrypted (AES-GCM) under a fresh **non-extractable**
  Web Crypto key stored as a CryptoKey object in IndexedDB, and the encrypted key plus the time the delay ends (set
  when the tab is hidden or unloads) sit in that tab's session storage. A load reads them once, opens the key only
  for a reload of the tab (navigation type "reload") or a discarded tab brought back (`document.wasDiscarded`), inside
  the delay for the same account, and deletes both at once whatever happens; a link, a typed address, back/forward,
  a reopened closed tab, expired, missing or failing means the lock screen (a back-forward cache restore locks too). Locking, signing out, another account and setting "immediately" delete them. The apps keep locking on
  every start (`apps/web/src/core/resume.ts`, D11). Locked state hides all content (an opaque lock screen; on Android `FLAG_SECURE` is
  on by default so the recents thumbnail and screenshots are blank; on desktop the window's content protection
  is on by default).
- **How it unlocks:** the **device's own verification** when it has one (Android: fingerprint / face / screen
  lock through BiometricPrompt with DEVICE_CREDENTIAL, as Money Manager does; web, PWA and desktop: a WebAuthn
  platform authenticator registered at first unlock - Windows Hello, Touch ID, Android screen lock in Chrome -
  with "Use password instead" always available), otherwise the **password**. After five wrong tries in a row each further try waits longer (1 min, 5 min, 15 min, then 1 hour each); the journal stays locked and nothing is ever deleted or signed out by wrong tries.
- **Cryptographically, on the apps,** the data key is dropped from memory on lock and comes back from the
  Keystore / safeStorage after device verification. On the web the key is dropped from memory too and comes back
  from the password or from WebAuthn's PRF output; without PRF, the password (limits stated in docs/security.md).
- The lock cannot be turned off, only its delay changed; the device-verification option can be turned off (then
  it is always the password).

### 4.4 Always a way back in

| Forgot | Way back |
|---|---|
| Password, has the recovery key | Sign-in screen → Forgot password → recovery key → new password; a new recovery key is shown |
| Password, has a signed-in app (phone or desktop) | Open the app (device verification unlocks it) → Settings → Security → Change password: the device holds the data key, so no old password is needed |
| Password, nothing else | Admin resets the sign-in password (CLI / admin panel); the person signs in but the journal stays sealed until a recovery key or signed-in device re-wraps it - this is shown plainly |
| Authenticator | A backup code; or the admin turns 2FA off |
| Recovery key | Make a new one in Settings → Security (needs the password) |

Settings → Security shows a **"Can you get back in?" checklist** (recovery key saved · another device signed in ·
backup codes saved · automatic backups on) and nags gently when none of it is true.

### 4.5 Isolation and tests

Motus §4.3 and §4.5 unchanged: `user_id` and RLS on every user table, UUIDv7, per-user SSE, authenticated media,
an isolation test suite. Added: a **sealing test** - a server-side dump of every user table contains no plaintext
from a dream written through the API; a **crypto test** - wrap/unwrap by password, recovery key and device key,
password change, recovery flow.

## 5. Data model

All user tables have `user_id`, `created_at`, `updated_at`, `deleted_at` (soft delete for sync) and RLS.
Sealed columns are marked (S).

- `nights`: date (the morning's date), bedtime, wake time, sleep quality 1-5, wbtb_used, wbtb_wake_at,
  wbtb_minutes_awake, nap (bool), substances (S, free text), caffeine_after (time), alcohol (bool), notes (S),
  techniques_planned (array of technique ids), techniques_done, intention (S).
- `dreams`: night_id, position in the night, title (S), text (S), lucid (bool), lucidity_level 0-5 (the DLQ /
  Waggoner scale, §7.4), control 0-5, vividness 1-5, recall_clarity 1-5, emotion_overall -2..2, duration_est,
  nightmare, recurring, false_awakening, sleep_paralysis, became_lucid_how (dream sign / reality check / WILD /
  spontaneous / nightmare / other), lucid_trigger (S, which sign), wake_method (alarm / natural / WBTB), favourite.
- `elements`: the person's taxonomy: kind (character / place / object / action / emotion / theme / sensation /
  dream sign), name (S), aliases (S), colour, note (S), is_dream_sign, sign_category (inner awareness / action /
  form / context, LaBerge), confirmed (bool: the person agreed with a suggestion).
- `dream_elements`: dream_id, element_id, source (manual / detected / ocr), confidence, span (S, where in the text).
- `media`: dream_id, kind (photo / sketch / audio), file (sealed blob), ocr_text (S), duration.
- `reality_checks`: at, kind (nose / hands / text / clock / light / jump / finger-palm / other), outcome (awake /
  unsure / dreaming), prompted (bool, from a reminder), note (S).
- `practice_log`: date, item (lesson id / technique id / habit id), done, minutes, note (S).
- `course_progress`: lesson id, state, done_at, answers (S).
- `goals`: kind (recall per week, lucid per month, reality checks per day, journaling streak), target, period.
- `reminders`: kind (reality check / bedtime / wbtb / morning journal / practice / custom), schedule JSON, on.
- `settings` (per user, synced): units and formats, features on/off, lock delay, notification choices, appearance.
- `sessions`, `users`, `invites`, `two_factor`, `backup_codes`, `recovery`, `device_keys`, `activity_log`,
  `app_meta`, `sync_log`: as Motus's system tables, extended for §4.

## 6. Screens and features

This section is the target structure for the app's pages, tabs and the order of sections on each page. It
supersedes the earlier layout (seven rail entries with Signs and Insights, five phone tabs with Learn, Train as one
long page of nine cards). The rule behind it: one obvious place per thing, a daily loop of under 10 taps on a
phone, and the Motus layout. Navigation code and pages are moved to match in separate tasks; until each move
lands, the code may still show the old arrangement. Navigation follows Motus §10.0: short, calm, one primary
action per screen.

### 6.0 Navigation
- **Phone tabs** (3 + 3 around the centre, as Motus): **Home · Journal · Train · [+] · Dream signs (label "Signs") · Progress · More**. The centre **+**
  opens the quick-add sheet (Motus StartSheet pattern). **More**: the account card, then Learn, Settings.
- **Desktop rail (7)**: **Home · Journal · Train · Dream signs · Progress · Learn · Settings**, plus a **+** button
  (Motus desktop FAB) opening the same quick-add sheet.
- **Quick-add sheet**: Write a dream, No recall, Log a reality check, Plan tonight, Day note. These are the only
  entry points for adding; pages do not repeat them as extra buttons.
- **One home per thing**: reality checks, course practice, tonight's plan, goals, day notes, typical themes,
  For you and the self-assessments each live on one page (below). Other pages show a short summary that links
  there, never a second editor.

### 6.1 Home (daily dashboard, in time-of-day order)
1. **Greeting and date**.
2. **This morning**: a big "Write last night's dream" button until a dream (or "no recall") is logged for today;
   then last night's summary (dreams, lucid or not, recall streak) with **Night details**.
3. **Today**: one checklist: reality checks x of y with the next reminder, course practice, the top dream sign,
   memory targets. The same checklist is used on Train > Today.
4. **Tonight**: techniques, intention, bedtime and WBTB alarm as a summary, with one **Plan tonight** button that
   opens Train > Tonight.
5. **Streaks and rates**: journaling streak, recall rate (dreams per night, 14 days), lucid dreams this month; links
   to Progress.
6. **For you**: the recommendations shown here (§8.2), with reasons and sources.
7. Blocks the person shows, hides and orders with **Edit home** (top dream signs, the next lesson, a tip from Learn,
   last lucid dream, pinned goals, day note); the layout is `settings.home.blocks`, so the switches live on Home itself,
   not in Settings → Features. Block ids a version doesn't know are kept when it saves (only Reset drops them).

### 6.2 Journal
- **Last night strip** at the top, then search and filters (text, elements, dates, lucid, nightmare, recurring,
  favourite), and the list by night (newest first) with lucid / nightmare / favourite marks, or the calendar month
  view with dots (Motus's history calendar). All on the device replica.
- **Write a dream** (phone: full-screen, opens with the keyboard; desktop: side panel): title, text (present
  tense is suggested in the placeholder), quick chips for lucid / vivid / nightmare / recurring / false awakening,
  sliders for lucidity 0-5 and vividness, emotions chips, elements (type-ahead from your taxonomy; suggestions
  appear as you write, §7), photos (camera / file; OCR offered), sketch (simple canvas), voice note. Saves as you
  type (draft), never loses text.
- **No recall** for a night: one button (counts as a logged night; keeps the streak; matters for the recall rate).
- **Night details** per night, opened from the night itself, also for no-recall nights: bedtime, wake time, sleep
  quality, WBTB, techniques used, substances, nap.
- **Day notes** are shown inside their day (added from the + sheet); only their lag analysis is in Progress.
- Dream page: the text with detected elements underlined (tap to confirm / reject), the night's facts, related
  dreams (sharing elements), "Mark as dream sign", export as Markdown, delete (in the ⋮ menu).
- Import: Markdown / text / CSV files, photos of handwritten pages (OCR → review → save), and files from other apps
  (§12), opened in place from the Journal.

### 6.3 Train (three tabs)
- **Today**: the course lesson with its "ready to move on" rule, today's checklist (the same one as Home), memory
  targets, reminders setup, and meditation / dream yoga when switched on.
- **Tonight** (the one place to plan the night): techniques, intention, bedtime and WBTB alarm (computed from
  bedtime and sleep cycles, §9), guided bedtime starts (MILD flow with your dream sign and intention), and the
  **Evening review** as the last step.
- **Techniques**: the library (every technique with origin, evidence level, steps, when to do it, **Use tonight**),
  the guided tools (SSILD cycle timer, WBTB planner, WILD relaxation with a soft timer) and the sound cue. Learn's
  technique pages are this same page.
- **The course** (behind Today; RESEARCH.md; §8.1): Recall → Journal habits → Dream signs and reality checks →
  MILD + WBTB → Stabilisation → WILD/SSILD → Dream control and uses. Each lesson: what to do, why (with the
  studies), today's practice items, a "ready to move on" rule from your own data.
- **Reality checks** are logged through the single Log a check action (the + sheet, Home, Today) and return to the
  screen they started from; the separate drill and header button are folded into it.
- Sub-screens have real addresses, with a back button to where you came from.

### 6.4 Dream signs
In action order:
1. **Your signs**, each with the check to pair with it (LaBerge's category; the shortlist of elements marked as
   signs, ranked by frequency × oddness).
2. **To confirm**: elements the app found across dreams that you have not confirmed (minimum support rule, §7.2),
   one tap to confirm, merge or dismiss.
3. **Elements by kind** with counts, last seen, trend sparkline. A sign's page: every dream it appears in,
   co-occurring elements, how often it led to lucidity.
4. **Typical themes** (Nielsen 2003 list) you have had, with the population prevalence beside yours. Shown here
   only, not in Progress.

### 6.5 Progress (was Insights)
Ordered by what matters for lucid dreaming; numbers as stat tiles, one chart per card.
- **Goals**: their one home (pinnable to Home).
- **Lucidity**: lucid dreams per month, lucidity level distribution, how lucidity started (sign / check / WILD);
  quality since the first lucid dream: level and control by month, share lasting a few minutes or longer, how it ended,
  and a plain "mostly level 3, up from level 1" line (LDJ-165).
- **What works for you**: lucidity rate on nights with each technique vs without, WBTB vs not, with wake duration
  bands, sleep length bands, nap vs no nap, bedtime bands - with sample sizes and a plain "not enough nights yet"
  when under 10. Honest, no p-values dressed up.
- **Recall**: dreams per night, nights with recall, trend; weekday pattern.
- **Sleep**: hours asleep by week, usual bedtime and how much it varies, WBTB nights against the others, a "sleep
  first" flag when the last 7 nights average under 6 h; nothing until 7 nights have both times (LDJ-160).
- **Checks**: reality checks per day, by kind, prompted vs own, "dreaming" outcomes (these are the lucid moments).
- **Night events**: elements and emotions over time, nightmares, false awakenings, sleep paralysis.
- **Day-note lag**: the analysis only; the notes themselves are in the Journal.
- **Self-assessment** (LuCiD, DLQ, MADRE): the answers over time, first and latest beside the logged rates, and the questions themselves (/progress/self-assessment), linked from Learn.
- **Reports**: month report and year in review (optional features).

### 6.6 Learn (§10)
Reading only: sections, glossary, FAQ, resources, with search and reading progress. "Try it" links open the
technique in Train (technique pages are the same page as Train's Techniques). Questionnaires are answered and
their results kept in Progress, not here.

### 6.7 Settings
Grouped around dreaming first. Account (name, signed-in devices, sync), **Servers & accounts** (named servers, add /
rename / remove, switch between them and this device's local account, sync status per account), **Security** (app
lock and delay, device verification, password, recovery key, two-factor and backup codes, "can you get back in?"
checklist, sign out everywhere, activity log), a **Practice** group (Sleep: usual bedtime and wake time, cycle
length, kept in one place; Reminders: reality checks schedule, quiet hours, bedtime, WBTB, morning, practice;
Training), Appearance (Money Manager's panel), Features (each switch says where it appears), Backup & restore
(automatic, encrypted), Data (export, import, delete account), App & versions (updates), Server admin, About
(licences, sources).

## 7. Dream analysis

Everything runs on the device, offline, on the replica. Nothing is sent anywhere.

### 7.1 Element detection ("the app reads your dream")
1. Text is tokenised and lemmatised with `compromise`; nouns, proper nouns, people, places, verbs are candidates.
2. Candidates are matched against: (a) the person's own elements and aliases (always wins), (b) the bundled
   lexicons in `packages/knowledge/lexicons`: characters (family roles, professions, animals, celebrities as a
   class), places (home, school, work, vehicles, nature, cities), objects, actions (flying, falling, being chased,
   running, driving, fighting, talking, searching), emotions (an emotion lexicon with an open licence, see
   RESEARCH.md), sensations, and **typical dream themes** (Nielsen 2003 / Schredl), and **dream sign categories**
   (LaBerge's inner awareness / action / form / context cues such as "could fly", "teeth fell out", "my dead",
   "didn't make sense", "appeared out of nowhere").
3. Each hit becomes a suggested element with a confidence and a span; the editor underlines it; one tap confirms.
   Confirmed suggestions teach the matcher (a confirmed alias is kept in the element).
4. Photos: `tesseract.js` OCR on device (English data bundled, loaded on first use), then the same pipeline; the
   OCR text is editable before saving.

### 7.2 Dream sign ranking
- An element is a **dream sign candidate** when it appears in ≥ 3 dreams (or ≥ 2 within 30 days) and is in a
  sign-ish category (odd form, impossible action, dead person alive, place mix-ups, inner-awareness cues) or the
  person marked it. Score = frequency × recency weight × category weight; the shortlist shows the top 5 with
  "what to do when you see it".
- Co-occurrence (elements that appear together), lag effects (an element's first appearance 1-2 days and 5-7
  days after it was tagged in a note of the day, if the person uses day notes), and "which signs preceded lucid
  dreams" (signs tagged in lucid dreams vs non-lucid).

### 7.3 Rates and streaks
Recall rate = nights with ≥ 1 dream / logged nights (no-recall nights count as logged). Lucid rate = lucid dreams
/ nights, and lucid nights / nights. Streak = consecutive mornings with a logged night. These feed Home, Insights,
the course's move-on rules and the recommendations.

### 7.4 Scales used
- Lucidity 0-5: 0 not lucid · 1 brief flash, lost at once · 2 knew but little clarity or control · 3 lucid, some
  control · 4 lucid, clear, controlled · 5 fully lucid, long, stable (adapted from the DLQ and Waggoner; sources in
  RESEARCH.md). Control 0-5 (0 = none), vividness and recall clarity 1-5, with one-line anchors. Sleep quality 1-5.
- Self-assessment questionnaires in Learn → "Where am I": the Lucid Dreaming Frequency Scale item, dream recall
  frequency item (MADRE wording), optionally the DLQ for the last lucid dream.

## 8. Training, techniques and the recommendation engine

### 8.1 The course (lessons; details in RESEARCH.md)
1. **Recall** (week 1-2): journal every morning, "no recall" counts, keep still on waking, intention before sleep;
   move on when ≥ 4 dreams/week.
2. **Journal habits**: present tense, title, emotions, elements; the dream sign inventory exercise.
3. **Reality checks**: pick 2 checks (nose pinch + text re-read by default), do them with a real question, at
   habit moments and on reminders; drill; move on after 7 days with ≥ 5/day.
4. **MILD + WBTB** (Aspy 2017 protocol): WBTB after ~5 h, 5-10 min up (longer is fine), MILD with the sentence
   "The next time I'm dreaming, I will remember that I'm dreaming", visualise, fall asleep within 5 min; 2-3
   nights a week on free days; move on after the first lucid dream or 4 weeks (then adjust).
5. **Stabilise and stay**: rub hands, look around, say "clarity", spin when fading; expect; don't over-excite.
6. **SSILD and WILD**: SSILD cycles after WBTB; WILD basics with hypnagogia, sleep paralysis facts and safety.
7. **Dream control and uses**: expectation, asking the dream, nightmare work (confront or befriend), skill
   practice, creative work, dream yoga practices (as traditions).
8. **Troubleshooting**: dry spells, sleep loss, false awakenings, over-doing it; safety rules.

### 8.2 Recommendations (rules, shown on Home and Train with their reasons and sources)
- Recall rate under 50% of nights → "Work on recall first: ... (MILD success depends on recall - Aspy 2017)".
- Recall good, no lucid dream in 3 weeks, no WBTB nights → suggest MILD + WBTB on the next free night; offer to
  set the WBTB alarm from your usual bedtime.
- Lucid rate on WBTB nights clearly higher than without (≥ 10 nights each) → "WBTB works for you: plan 2-3 a week".
- Sleep quality falling in weeks with ≥ 3 WBTB nights → "Ease off: 1-2 WBTB nights a week" (sleep first).
- Reality checks under 3/day → raise the reminder count or add habit moments.
- Many false awakenings → reality check on every awakening; dream sign "waking up".
- Nightmares ≥ 2/month → the nightmare lesson (lucidity treatment evidence) and the "safety" page.
- Nothing in the app ever recommends a substance; the galantamine evidence is in Learn as information with its
  risks, and the app says so.

## 9. Reminders and notifications

- **Reality check reminders**: N per day (default 8; recommended 6-12), randomly spread over the waking window
  (default from wake time + 1 h to bedtime - 1 h), minimum gap 30 min, quiet hours, pause for today, "habit
  moments" (fixed times the person adds: walking through a door, after a meal). The notification text is the
  question ("Are you dreaming? Really check.") plus the check and, when there is one, the person's top dream sign.
  Tapping logs the check with its outcome.
- **Bedtime**: at bedtime - 15 min: tonight's technique and intention.
- **WBTB alarm**: computed from bedtime + chosen sleep (default 5 h, choices 4.5-6 h) rounded to the sleep-cycle
  boundary (90 min default, adjustable), only on nights with WBTB in the plan; "I'm up" opens the MILD / SSILD
  guide; "back to bed" ends the awake timer and logs the minutes.
- **Morning**: at wake time: "Write your dream" (opens the editor; "No recall" is one tap).
- **Practice**: optional daily reminder for the course.
- Android: local notifications with exact alarms (permission flow), a quick-action to log the check from the
  notification. Web/PWA: Notification API; scheduling by the service worker while the page or PWA is open, and
  honest text in Settings about the browser's limits. Desktop: Electron notifications from the main process timer.

## 10. Knowledge base (Learn)

`packages/knowledge/content/*.md`, built from RESEARCH.md, every article with a sources list and "last reviewed"
date. Sections: What lucid dreaming is · History (antiquity, Tibetan dream yoga, Hervey de Saint-Denys, van Eeden,
Green, Hearne, LaBerge, modern labs) · The science (sleep, REM, the lucid brain, how it is verified) · Techniques
(each with evidence level) · Traditions (dream yoga, with practices) · Tools and devices (what works, what does
not) · Substances (information and risks only) · Benefits and uses · Risks, safety and who should not practise ·
Dream signs and dream content (typical dreams with prevalence) · People's experiences (quoted from published
accounts with sources: van Eeden's reports, Hervey de Saint-Denys, LaBerge's and Waggoner's published accounts,
study participants' quotes) · Glossary · FAQ · Sources. Searchable, offline, with "try it" links into Train.

## 11. Design system and appearance

Money Manager's theme engine and Appearance panel, as ported to Motus (§10.1-10.2 there) - the same tokens,
atmospheres, backgrounds, textures, surfaces, corners, fonts, density, saved looks. **Default look for Somnium:**
a new atmosphere **"Dusk"** - dark, deep indigo-violet background `#141233`, accent lavender `#a99cff`, second
glow `#6fd6ff`; "glow" background. Everything else identical. The icon: the shared rounded square with a diagonal
gradient (indigo `#5b4de0` → violet `#a78bfa`), a crescent moon whose inner curve frames an open eye (awake inside
the dream), in the same flat deep-navy glyph colour family as the other icons.

Anti-bloat rules of Motus §10.0 apply. Optional features (Settings → Features; off and absent until switched on):
voice notes, sketches, photos and OCR, meditation timer, dream-yoga practices, month report and year in review,
day notes (for lag analysis), goals, typical-dream themes comparison, Markdown export per dream, sharing a dream
as text, the optional local text model hook (a user-run Ollama URL on the LAN; off by default; the app never
ships a cloud key). Home's extra cards (dream signs, next lesson, tip, last lucid dream) are not features: they are
shown, hidden and ordered in Edit home on Home (§6.1).

## 12. Backup, restore, export and import

Motus §9 as is (device backups on a schedule to a folder / Android Documents / a download; keep N; restore by
merge or replace), with these changes: backups are **always encrypted** (with the account password or a passphrase;
the file holds the wrapped data key so the recovery key can open it too), and a backup reminder joins the "can
you get back in?" checklist. Export: JSON (everything), Markdown (one file per dream or one big file), CSV
(dreams, nights, reality checks). Import: Somnium backups, Markdown/text/CSV, photos (OCR), and the export
formats of common journal apps as far as they are documented (RESEARCH.md §6 lists them).

## 13. Apps, updates and releases

Motus §12 unchanged: `release.yml` from CHANGELOG.md, Docker image on GHCR, electron-builder for Windows and
Linux with auto-update, signed APK with `android-latest.json` and the in-app updater, Obtainium-compatible,
Watchtower overlay. **No `## [x.y.z]` heading in CHANGELOG.md until 0.1.0 is complete** (that heading publishes
a release). The repo is public from the start, so nothing personal may ever be in it.

## 14. Self-hosting and development

- `docker-compose.yml` (postgres + app on `127.0.0.1:8800`), `setup.sh` / `.env.example`, Caddy example.
- Dev: `docker-compose.dev.yml` → https://somnium.local (shared Caddy proxy, mkcert cert `somnium.pem`,
  container `somnium-web`), direct http://127.0.0.1:8800; the built app with the dev database on
  http://127.0.0.1:8801 for the phone via Tailscale `https://<machine>.<tailnet>.ts.net:8444`
  (8443 is Motus). Rules for the shared proxy: Motus docs/development.md.
- `scripts/pnpm.sh`, `scripts/bump.mjs`, `scripts/release-notes.mjs`, git hooks (`.githooks`), CI.

## 15. Delivery phases and task list

The Focus list "Lucid Dreaming journal" holds the tasks (`LD-n`). Phases:

1. **Foundation**: repo, privacy hooks, dev environment, the Motus port (engine, server, web shells, theme,
   settings, appearance, bars, updater, backups, sync), the icon, CI.
2. **Security**: sealed journal crypto, sign-in with 2FA and backup codes, recovery key, app lock on web and
   desktop (WebAuthn + password), Android lock plugin, device keys, security docs and tests.
3. **Journal**: nights, dreams, editor, list and calendar, search, no-recall, dream page, import of text.
4. **Analysis**: elements and lexicons, detection in the editor, Signs page, ranking, OCR of photos, Insights.
5. **Training**: techniques library, course, tonight's plan, guided MILD / SSILD / WBTB, habits, recommendations.
6. **Reminders**: reality check scheduler and notifications on web, desktop and Android; bedtime, WBTB, morning.
7. **Learn**: the knowledge base content and reader, glossary, questionnaires.
8. **Apps and release**: desktop app, Android app, backups, export/import, release workflow, docs, 0.1.0.

## 15.1 Added from the research (gaps the brief did not name)

- Sound-cue training (targeted lucidity reactivation, Carr 2020; Konkoly 2024) as an optional feature.
- Lucid nap planner (LaBerge 1994 nap technique) and WBTB modes: short (Aspy 2017) and long (Erlacher & Stumbrys
  2020: 6 h + 60 min with MILD), a warning under 4.5 h of sleep, CAT schedules.
- Prospective-memory training targets (LaBerge) and the Dreamsign Awareness Scale (0-4, Lucidity Institute course).
- The LuCiD scale, DLQ and MADRE items as self-assessments; per-sign lucid rate on the Signs page.
- Typical dream themes with population prevalence (Nielsen 2003) beside the person's own.
- Safety guidance shown verbatim from the evidence (who should not practise, sleep first, ease off).

## 16. Decisions log

- D1 Name Somnium; Latin like Motus.
- D2 Sealed journal (end-to-end encryption) with password / recovery key / device key envelope; the server never
  reads dreams. Trade-off accepted: no admin-side data recovery.
- D3 App lock on every platform, default lock immediately on leaving the app (default changed by D11); device verification where the
  platform has it; password fallback; cannot be turned off.
- D4 All analysis on the device: lexicons + `compromise` + `tesseract.js`; no cloud and no bundled model server.
- D5 Motus architecture and look kept whole; new default atmosphere "Dusk".
- D6 English only; all UI strings in one file.
- D7 No substance recommendations; evidence shown as information with risks.
- D8 Dev ports 8800 / 8801, Tailscale 8444, site somnium.local.
- D9 (2026-11-15) One target structure for pages and tabs (§6, supersedes the earlier layout): phone tabs Home · Journal · [+] · Train · Progress · More; desktop rail Home · Journal · Train · Dream signs · Progress · Learn · Settings with a + button; Train in three tabs (Today, Tonight, Techniques); Insights renamed Progress; Learn is reading only. Each thing has one home, and other pages summarise and link to it.
- D10 (2026-11-15) The developer asked for an even 3+3 phone bar with Dream signs on it and Learn under More: Home · Journal · Train · [+] · Dream signs · Progress · More (amends D9's phone tabs).
- D11 (2026-11-15) The developer found the lock too eager: every page refresh and every switch to another tab asked for
  the password. The lock's default delay is now **10 minutes** away (10 minutes added to the choices); a saved
  "immediately" from before this moves to it, since it was the old default and was saved with any change to the idle
  time; other saved choices stay. A browser tab that reloads (or is discarded and brought back) within the delay
  opens without the lock screen, for the same account (§4.3). Security reasoning: the key was already open in that
  tab's memory and would have stayed open for the delay had the page not reloaded, so the grace adds no time. It is
  never written in the clear: it is AES-GCM encrypted by a non-extractable key that only the browser can use (stored
  as a CryptoKey in IndexedDB, whose bytes no script can read), and the ciphertext lives in session storage, per tab
  and gone with it. Only a reload (or a discarded tab brought back) may use them, not a link, a typed address,
  back/forward or a reopened closed tab. Both are deleted by the next load whether used or not, on lock, sign-out and
  account change, and with "immediately". The limit:
  anyone with this browser profile and the tab's session storage inside the delay can open the journal, as they could
  by looking at the open tab; the browser profile already holds the plaintext copy (§4.1). The apps don't reload in
  normal use and keep locking at every start; the desktop app still locks at once when closed to the tray.
- D12 (2026-11-15) The developer chose the command palette (Ctrl+K, ⌘K on a Mac) **on by default on a computer**, with a "Search" hint with its shortcut in the desktop rail (not on the phone). An exception to "optional features off" (§11): it is invisible until used and costs nothing on the phone. It is still a switch in Settings → Features. Existing accounts: every save writes the whole features object, so a saved "off" cannot be told from the old default; it is read as a choice only when Settings stored `paletteSet` with it, otherwise the palette turns on.
