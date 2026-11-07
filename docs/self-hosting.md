# Self-hosting Somnium

Somnium runs as two containers: PostgreSQL and the Somnium app (API and web app in one image). The server only ever
holds your journal sealed (PLAN.md §4): what is personal is encrypted on your devices before it is sent.

## Start

```sh
mkdir somnium && cd somnium
curl -O https://raw.githubusercontent.com/userofit123/somnium/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/userofit123/somnium/main/.env.example
# edit .env: set DB_PASSWORD to a long random password
docker compose up -d
```

Somnium listens on `127.0.0.1:8800`. Open it through a reverse proxy with HTTPS (Caddy example below).
The first account you create becomes the admin.

```
somnium.example.com {
	reverse_proxy 127.0.0.1:8800
}
```

### The proxy and the client's address

The sign-in limits count wrong tries per client address, which the server reads from `X-Forwarded-For`. By default it
trusts **one hop**: the proxy right in front of it. That is what you want with one Caddy or nginx in front:

- **Caddy** sets `X-Forwarded-For` itself (it appends the client's address); `reverse_proxy` above needs nothing more.
- **nginx**:

  ```
  location / {
      proxy_pass http://127.0.0.1:8800;
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
  }
  ```

  `$proxy_add_x_forwarded_for` appends; with one-hop trust only the address nginx added counts, so a client cannot
  pick its own by sending the header. (Setting it to `$remote_addr` instead also works.)

Set `TRUST_PROXY` in `.env` only when that is not your setup:

| `TRUST_PROXY` | Meaning |
|---|---|
| unset or `1` | one proxy in front (default) |
| `2`, `3`, ... | that many proxies, e.g. a CDN in front of your own proxy |
| `127.0.0.1,10.0.0.0/8` | trust exactly these proxy addresses or ranges |
| `0` | no proxy: the socket's own address (not recommended) |

Never put more hops than you really have: each extra one lets a client choose the address it is counted under.

## Accounts

- Settings → Server admin: invite people, reset passwords, turn two-factor sign-in off, disable or remove accounts,
  choose who can sign up (only the admin, people with an invite link, or anyone).
- The server never sees a password: the device turns it into a sign-in key, and the journal's data key is stored
  only wrapped by that password (PLAN.md §4.1). So an admin cannot set a password. **Reset password** makes a
  one-time reset code (valid a day) with which the person chooses a new password on the sign-in screen; their
  journal stays sealed until they enter their recovery key, which re-wraps the data key. Without it, their dreams
  cannot be read by anyone, the admin included. (A reset signs out every device, and signing out forgets a phone's device key, by
  design, so no device can open the journal after a reset. While still signed in, a phone with device verification on can set a new password itself.)
- When nobody can get into the admin panel, the same two things work on the server itself (the admin CLI). With Docker:
  `docker compose exec app node --import tsx src/cli.ts reset-password <username>` and
  `docker compose exec app node --import tsx src/cli.ts disable-2fa <username>`.
  Without Docker, from the repository with the same `DATABASE_URL` or `DATA_DIR` as the server:
  `node --import tsx apps/server/src/cli.ts reset-password <username>` (and `disable-2fa`).
  `reset-password` prints a one-time reset code; the person still needs their recovery key to read their journal.
- The server's own key, `DATA_DIR/app.key` (made on first start, or given as `APP_KEY`, 32 bytes base64), encrypts
  two-factor secrets at rest and must stay with the database in backups.
- Every person's data is kept apart by the database itself (row-level security). Admins cannot see anyone's dreams, and the server could not show them anyway: they are sealed.

## Updates

Images are published at `ghcr.io/userofit123/somnium` (amd64 and arm64) with each release (from 0.1.0). If the pull is
refused, the package may still be private: the owner makes it public once in the repository's package settings.

- By hand: `docker compose pull && docker compose up -d`. Back up first (below); updates run the database migrations.
- Automatically: `docker compose -f docker-compose.yml -f docker-compose.autoupdate.yml up -d` (Watchtower, daily at 04:00;
  it updates only the app container, which carries the Watchtower label, never the database).
- Pin a version with `SOMNIUM_VERSION=0.1.0` in `.env`. A pinned install (with or without Watchtower) stays on that
  version until you change the number; with the default `latest`, Watchtower follows every release.
- Roll back by pinning the earlier version, if the database change allows it: restore the backup taken before the update when in doubt.

## Backups

- Each person makes their own backups in Settings → Backup & restore (to their device).
- For the whole server, back up both volumes, `db` (the database) and `appdata` (`/data`, which holds `app.key`).
  A database dump alone cannot be used without `app.key` for two-factor sign-in. For example:
  ```sh
  docker compose exec -T db pg_dump -U somnium somnium | gzip > somnium-$(date +%F).sql.gz
  docker compose cp app:/data/app.key ./app.key.backup
  ```
  (or stop the stack and copy the volumes' folders). The data in a dump is sealed, but treat the files as private.
- Restore: start the stack, then `gunzip -c somnium-DATE.sql.gz | docker compose exec -T db psql -U somnium somnium`
  on an empty database, and put `app.key` back into `/data` before the app starts.

## Without Docker

Node 22 and pnpm: `pnpm install`, `pnpm --filter @somnium/web exec vite build`, then
`DATABASE_URL=postgres://… WEB_DIR=apps/web/dist node --import tsx apps/server/src/index.ts`.
Without `DATABASE_URL` the server keeps its data in `DATA_DIR` with PGlite (fine for one person).
