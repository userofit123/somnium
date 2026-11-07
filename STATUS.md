# Status

What is built, what is left, and what needs you. Updated 7 November 2026. Nothing is released yet; the first release is 0.1.0.

## Built

Built and waiting for review (the task list calls this "In Review"):

- Foundation: the monorepo (engine, shared, knowledge, server, web, desktop and Android shells), the look ported from Motus, the app icon, the dev environment, CI on every push, git hooks for privacy, the public repository and its noncommercial licence.
- The sealed journal: client-side encryption with a data key wrapped by the password and the recovery key, sealed sync and device copy, sealed media, local accounts with a password and sealed at rest, plain text refused by the server, strict security headers.
- Sign-in with the auth key, sessions, invites, two-factor with backup codes, the recovery key and the forgot-password flow, wrong-try waits that never delete unsent dreams, lock and sync hardening.
- App lock on web, PWA, desktop and Android (delay and idle settings, password, WebAuthn or biometrics, nothing renders behind it); device keys in the Keystore or safe storage.
- The journal: nights and dreams, the editor, the dream page, on-device element detection, the Signs page, Insights and "What works for you", the recommendations engine, photos and on-device OCR, text import.
- Train and Learn: the techniques library, the course, tonight's plan and guided modes, the knowledge base with sources, offline search and the learning hub.
- Reminders: reality checks (the scheduler, also on Android), bedtime, wake-back-to-bed alarm, morning journal and practice reminders; the Home page.
- Servers and accounts, fully offline use, offline sync that merges nights, backups, export and import, Security settings.
- Security docs and tests: [docs/security.md](docs/security.md), with an isolation test through every route.

## In progress

- Release workflow and docs (the release workflow, the install table, self-hosting, apps and development docs): written, to be checked on the first real release.
- Desktop app (Electron, Linux and Windows) and its tray, so reminders arrive with the window closed.
- Train: practice habits and the prospective-memory exercise.

## Planned (not built yet)

- The Android app shell: local accounts on the device, server accounts, navigation.
- Sound-cue training, the lucid nap planner and wake-back-to-bed modes.
- Optional features (day notes, goals) and an optional local text model hook.
- End-to-end tests (Playwright), an accessibility and polish pass.
- Version 0.1.0: everything verified on web, desktop and Android, the changelog written, the first release.

## Needs you

- **Android signing key**, before the first release: create it outside the repository, keep a safe copy (every future update must be signed with it) and add the repository secrets `SOMNIUM_KEYSTORE_B64` and `SOMNIUM_KEYSTORE_PASSWORD` (optional: `SOMNIUM_KEY_ALIAS`, `SOMNIUM_KEY_PASSWORD`). Steps: [docs/development.md](docs/development.md), "Releasing (0.1.0 and later)".
- **Make the GHCR package public** after the first release (package settings of `ghcr.io/userofit123/somnium`, once), so `docker compose pull` works for everyone.
- **Test on a real phone and on the desktop apps** (Windows and Linux installers, auto-update, the tray, Android install and update over the old app, app lock with a fingerprint) before announcing 0.1.0.
- **Run `node scripts/bump.mjs 0.1.0`** yourself when everything above is done; pushing the version heading to `main` is what publishes.
