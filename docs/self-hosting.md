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

## Accounts

- Settings → Server admin: invite people, reset passwords, turn two-factor sign-in off, disable or remove accounts,
  choose who can sign up (only the admin, people with an invite link, or anyone).
- The server never sees a password: the device turns it into a sign-in key, and the journal's data key is stored
  only wrapped by that password (PLAN.md §4.1). So an admin cannot set a password. **Reset password** makes a
  one-time reset code (valid a day) with which the person chooses a new password on the sign-in screen; their
  journal stays sealed until they enter their recovery key, which re-wraps the data key. Without it, their dreams
  cannot be read by anyone, the admin included. (A reset signs out every device, and no device keeps the data key
  yet, so a signed-in device cannot open the journal after a reset; that comes with device-held keys, LDJ-10.)
- When nobody can get into the admin panel, the same two things work on the server itself (same `DATABASE_URL`
  or `DATA_DIR` as the server):
  `node --import tsx apps/server/src/cli.ts reset-password <username>` and
  `node --import tsx apps/server/src/cli.ts disable-2fa <username>`.
- The server's own key, `DATA_DIR/app.key` (made on first start, or given as `APP_KEY`, 32 bytes base64), encrypts
  two-factor secrets at rest and must stay with the database in backups.
- Every person's data is kept apart by the database itself (row-level security). Admins cannot see anyone's dreams, and the server could not show them anyway: they are sealed.

## Updates

- By hand: `docker compose pull && docker compose up -d`
- Automatically: `docker compose -f docker-compose.yml -f docker-compose.autoupdate.yml up -d` (Watchtower, daily at 04:00).
- Pin a version with `SOMNIUM_VERSION=0.1.0` in `.env`.

## Backups

- Each person makes their own backups in Settings → Backup & restore (to their device).
- For the whole server, back up the `db` and `appdata` volumes, e.g.
  `docker compose exec db pg_dump -U somnium somnium | gzip > somnium-$(date +%F).sql.gz`.

## Without Docker

Node 22 and pnpm: `pnpm install`, `pnpm --filter @somnium/web exec vite build`, then
`DATABASE_URL=postgres://… WEB_DIR=apps/web/dist node --import tsx apps/server/src/index.ts`.
Without `DATABASE_URL` the server keeps its data in `DATA_DIR` with PGlite (fine for one person).
