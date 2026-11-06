# Somnium: working notes

## Task queue
The chat message "Work the queue" means: read and follow `workflow/RUNNER.md` (tasks from the Focus list
"Lucid Dreaming journal", account "New Team"). Otherwise tasks come from the chat as usual. `workflow/` is
git-ignored and never committed.

Self-hosted lucid-dreaming journal and trainer. Plan: PLAN.md (security in §4, decisions in §16). Evidence and
knowledge-base source: RESEARCH.md. Built on Motus (`../Motus`), which was built on Money Manager
(`../moneymanager`): port from them, never reinvent.

## Layout
- `packages/engine`: all data logic (handlers, SQL migrations, row-level security, sync). PostgreSQL (server) and
  PGlite (device replica, local accounts, tests).
- `packages/shared`: types and pure logic (analysis scoring, scheduling maths, settings, features, crypto helpers).
- `packages/knowledge`: Learn articles (Markdown with sources) and the lexicons for dream analysis.
- `apps/server`: Fastify around the engine: sign-in, sessions, 2FA, recovery, admin, SSE, sealed blobs.
- `apps/web`: Vue 3 + TypeScript UI. Two shells (desktop rail, phone tabs) sharing pages. Look ported from Motus.
- `apps/desktop`: Electron. `apps/android`: Capacitor.

## Rules
- **Private from the start.** Nothing personal in the repo, commits or app: no name, email, location, analytics,
  telemetry, crash reporting. Git identity is `userofit123` with the GitHub no-reply address (the pre-commit hook
  enforces it; commit times are UTC by the post-commit hook). The only network requests the app makes are to the
  person's own server and the optional update check (GitHub's public releases, no identifiers).
- **The journal is sealed** (PLAN.md §4): dream text and every personal field are encrypted on the device; the
  server stores ciphertext in the sealed columns listed in `packages/engine/src/sealed.ts` and never queries them.
  New personal columns go on that list. Keys never touch logs, errors, the activity log or exports in the clear.
- **App lock everywhere**: nothing renders behind the lock screen; new screens must not leak through it
  (no toasts with content, no notifications with dream text).
- Clean by default (Motus PLAN.md §10.0): one primary button per screen; secondary actions in ⋮ menus; optional
  features off and absent until switched on in Settings → Features.
- Styles only through the theme tokens (`--acc`, `--s1`, `--tx2`, ...); never hard-coded colours. Spacing from
  the density tokens inside blocks and `--spg` / `--hg` between blocks; no fixed paddings on cards, rows, sections.
- Every change announces what it touched (`ctx.changed(...)`, topics in `packages/shared/src/live.ts`) so all
  screens update live; every user-owned table has `user_id` and an RLS policy; new write paths sync offline.
- All analysis runs on the device (lexicons, `compromise`, `tesseract.js`); no cloud calls, no bundled keys.
- Recommendations and Learn content cite their sources (RESEARCH.md reference numbers); no claim without one.
- Plain wording in the UI. Comments say why. Only plain dashes "-" in the UI, never "–" or "—". Dot separators
  with equal space on both sides (" · "). Both desktop and phone layouts for every screen.

## Develop
- `docker compose -f docker-compose.dev.yml up -d` → https://somnium.local (see docs/development.md).
- Run pnpm through the container: `./scripts/pnpm.sh ...` (e.g. `./scripts/pnpm.sh --filter @somnium/engine test`).
- Checks: `./scripts/pnpm.sh -r typecheck`, `./scripts/pnpm.sh --filter @somnium/engine test`,
  `./scripts/pnpm.sh --filter @somnium/web exec vite build`.
- Release: `node scripts/bump.mjs x.y.z`, fill in CHANGELOG.md, push to main. Not before 0.1.0 is complete.
