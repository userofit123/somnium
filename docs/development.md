# Development

Watch the app at **https://somnium.local** while it is built. Saved changes show up live: the page hot-reloads
for the web app, and the server restarts by itself. (The setup is Motus's, ported: the same containers, proxy and
nudge service, on Somnium's own names and ports.)

## Start and stop

```sh
docker compose -f docker-compose.dev.yml up -d      # start (installs packages first)
docker compose -f docker-compose.dev.yml logs -f    # watch logs
docker compose -f docker-compose.dev.yml down       # stop (the database is kept in the "somnium_db" volume)
```

Without the proxy, the same app is at http://127.0.0.1:8800.

| Container | What it does |
|---|---|
| `somnium-db-1` | PostgreSQL 16, on an internal-only network with no published port |
| `somnium-server-1` | API server (`apps/server`), restarts when a file in `src/` changes |
| `somnium-web` | Vite dev server (`apps/web`), hot reload; `/api` is forwarded to the server |
| `somnium-install-1` | Installs packages on every `up`, then exits |

Run pnpm through the same image: `./scripts/pnpm.sh -r typecheck`, `./scripts/pnpm.sh --filter @somnium/engine test`,
`./scripts/pnpm.sh --filter @somnium/web exec vite build`.

## One-time setup on this computer

1. **Name lookup** (needs sudo): `echo '127.0.0.1 somnium.local' | sudo tee -a /etc/hosts` (done on this machine).
   Without it: `curl -sk --resolve somnium.local:443:127.0.0.1 https://somnium.local/api/version`.
2. **Live file updates:** `./scripts/dev-setup.sh` installs the `somnium-dev-nudge` user service (Motus has its own,
   `motus-dev-nudge`; they run side by side).
   - Docker Desktop shares files with its VM over virtiofs. A file saved by replacing it (most editors,
     Claude Code) stays stale inside the containers.
   - The service rewrites one byte in place after each replacement, which makes the change appear.
   - Check it: `systemctl --user status somnium-dev-nudge`.
3. **HTTPS** goes through the shared Caddy proxy (container `caddy-proxy`; its folder is outside this repo),
   with a mkcert certificate `certs/somnium.pem`. Both are already in place on this machine. The Somnium block:

   ```
   https://somnium.local {
   	tls /etc/caddy/certs/somnium.pem /etc/caddy/certs/somnium-key.pem
   	encode zstd gzip
   	reverse_proxy somnium-web:5173
   }
   ```

## Rules for touching the shared proxy (other sites depend on it)

- The Caddyfile is bind-mounted **as a single file**. Edit it **in place**, e.g. append with `>>`.
  Never use `sed -i` or an editor that saves by replacing the file: the container keeps the old copy, and
  the next restart can break every site.
- Back it up first, then **validate**, then **reload**. Never restart or recreate the proxy container:
  ```sh
  docker exec caddy-proxy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
  docker exec caddy-proxy caddy reload   --config /etc/caddy/Caddyfile --adapter caddyfile
  ```
  A reload with a broken config is refused, and the old config keeps running.
- Afterwards, check every site behind the proxy still answers, somnium.local and motus.local included.
- Somnium only joins the external `proxy` network. It never publishes ports 80 or 443.

## Opening the dev app from a phone

The phone gets the built app (a few bundled files, like a real install, so it opens as fast as one) with the dev
database: the `phone` service rebuilds it into `apps/web/dist` on every change (a few seconds), and the dev server
serves it on http://127.0.0.1:8801. Tailscale shares that with your devices at `https://<machine>.<tailnet>.ts.net:8444`
(8443 is Motus's, 443 another app's). It is already set up on this machine; it was done once with

    tailscale serve --bg --https=8444 http://127.0.0.1:8801

and Tailscale keeps it across restarts (`tailscale serve status` shows it, `tailscale serve --https=8444 off` removes it).
No hot reload there: reopen the app to get the latest build. (The development server with hot reload is on 8800;
point Tailscale at that instead when you need it on the phone, but it loads slowly over the network.)

## Checks

```sh
./scripts/pnpm.sh -r typecheck        # every package: engine, shared, knowledge, server, web (vue-tsc), desktop
./scripts/pnpm.sh -r test             # all tests, including the data-isolation tests
./scripts/pnpm.sh --filter @somnium/web exec vite build
```

CI (`.github/workflows/ci.yml`) runs the same on every push and pull request, and compiles the Android app (debug build,
unsigned). The engine tests run two files at a time (`maxForks: 2` in `packages/engine/vitest.config.ts`) because each
holds several in-memory PostgreSQL copies; do not raise it on a small machine.

## Releasing (0.1.0 and later)

Nothing is published before 0.1.0 is complete. Until then `CHANGELOG.md` has only an `## Unreleased` section, and
`.github/workflows/release.yml` reads that as "no version: build nothing". **Never type a `## [x.y.z]` heading by hand
and never add one to a branch that is not ready:** pushing one to `main` publishes a release.

1. Write what changed under `## Unreleased` in `CHANGELOG.md` while you work (plain words, one bullet per change).
2. When ready: `node scripts/bump.mjs 0.1.0`. It sets the version in the root, desktop, Android and web
   `package.json` files and turns Unreleased into `## [0.1.0] - date`, with a fresh empty Unreleased above it.
   It stops if Unreleased is empty or the version already has a heading. Read the notes once more.
3. Commit and push to `main`. The workflow (also startable by hand: Actions, Release, with "rebuild" to build a
   version again) then:
   - reads the version from the top `## [x.y.z]` heading and skips when its tag `vX.Y.Z` already exists;
   - runs `pnpm -r typecheck` and `pnpm -r test`;
   - builds the web app once, the server image (`ghcr.io/userofit123/somnium:x.y.z` and `:latest`, amd64 and arm64),
     the desktop installers with `latest.yml` / `latest-linux.yml` (Linux AppImage, deb, rpm; Windows installer) and the
     signed APK;
   - creates the GitHub release `vX.Y.Z` with the notes from `scripts/release-notes.mjs`, the installers,
     `android-latest.json` (version, url, sha256, size) and `SHA256SUMS`, only when every build succeeded.
4. Make the GHCR package public after the first release (once), then check an install from the table in the README.

One-time setup: create the Android signing key outside the repository (`keytool -genkeypair -v -keystore somnium.jks
-alias somnium -keyalg RSA -keysize 4096 -validity 10000`), keep a safe copy (every later update must be signed with
the same key), and add the repository secrets `SOMNIUM_KEYSTORE_B64` (`base64 -w0 somnium.jks`) and
`SOMNIUM_KEYSTORE_PASSWORD`. Optional: `SOMNIUM_KEY_ALIAS` (default `somnium`) and `SOMNIUM_KEY_PASSWORD` (default: the
store password) are passed to `apps/android/android/app/build.gradle` by the workflow when set. The Android version comes from the workflow (`-PappVersion`).
