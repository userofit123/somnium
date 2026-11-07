# Status

What is built, what is left, and what needs you. Updated 7 November 2026.

## Built

- Foundation: the monorepo (engine, shared, knowledge, server, web, desktop and Android shells), the look ported from Motus, the dev environment, CI on every push, git hooks for privacy, the public repository.
- The sealed journal: client-side encryption with a data key wrapped by the password and the recovery key, sealed sync and device copy, sealed media, local accounts sealed at rest, plain-text refused by the server.
- Sign-in with the auth key, sessions, invites, two-factor with backup codes, the recovery key and the forgot-password flow, wrong-try waits that never delete anything.
- App lock on web, PWA and desktop (delay and idle settings, password or WebAuthn, nothing renders behind it).
- The journal: nights and dreams, the editor, the dream page, on-device element detection, the Signs page, Insights and "What works for you", recommendations.
- Train and Learn: the techniques library, the course, tonight's plan and guided modes, the knowledge base with sources and offline search.
- Reality-check reminders (the scheduler), the Home page, named servers and accounts, fully offline use, offline sync that merges nights.

## In progress

- App lock and device keys on Android (Keystore, BiometricPrompt), device keys for setting a new password.
- Security settings, backups (automatic encrypted device backups), export and import (JSON, Markdown, CSV, text files), photos and OCR.
- Night reminders (bedtime, WBTB alarm, morning journal) and Android reminders; lock and sync hardening.
- Security docs and tests: [docs/security.md](docs/security.md) is the full audit, with an isolation test through every route and raw SQL.

## Planned (not built yet)

Practice habits, the Android app shell and local accounts there, the desktop app polish and tray, sound-cue training, the lucid nap planner, optional features (day notes, goals), an optional local text model hook, the learning hub, the remaining docs, end-to-end and accessibility passes, the Docker image and the release workflow. First release: 0.1.0.

## Needs you

- **Android signing key**, before the first release: create it outside the repository, store it as repository secrets and keep a safe copy. Every future update must be signed with it.
- **A Content-Security-Policy** is not set by the server yet (see docs/security.md, "The network"): decide the policy, then it can be added and tested in a real browser.
