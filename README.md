# Somnium

A private, self-hosted lucid dreaming journal and trainer. Your journal is sealed: only you can read it, not even
your own server can. It works fully offline and keeps your data local to your device or on your own server. No
accounts with us, no analytics, nothing sent anywhere else.

## What you get

- A dream journal: write or dictate a dream in the morning, with tags, moods and lucid marks
- Dream signs found for you, from your own entries, on your device
- Reality-check reminders at times that suit you
- An evidence-based training course and techniques, step by step
- Insights from your own journal over time
- A Learn knowledge base where every claim cites its source
- App lock on every device
- Backups you control

## Install

Nothing is released yet: every row below is marked "with 0.1.0" until the first release exists. The Docker image is `ghcr.io/userofit123/somnium` (amd64 and arm64).

| | For | How |
|---|---|---|
| **Windows app** | One PC | With 0.1.0: download the installer from the [latest release](../../releases/latest) and run it |
| **Linux app** | One computer | With 0.1.0: download the .rpm, .deb or .AppImage from the [latest release](../../releases/latest) |
| **Docker** | A home server, always on, for all your devices | With 0.1.0: the commands below |
| **Android app** | Your phone | With 0.1.0: download the .apk from the [latest release](../../releases/latest), then add your server |
| **Phone web page (PWA)** | Using it from anywhere | With 0.1.0: open your server's address and choose Add to Home Screen |
| **Desktop app + your server** | The desktop app, using your server's data | With 0.1.0: choose My server the first time you open the app |

**Docker in three lines** (with 0.1.0; the app is served on port 8800):

```sh
git clone https://github.com/userofit123/somnium.git && cd somnium
cp .env.example .env            # then set the secrets in it
docker compose up -d            # http://127.0.0.1:8800 (put HTTPS in front: docs/self-hosting.md)
```

Details: [self-hosting](docs/self-hosting.md) · [desktop and Android apps](docs/apps.md) · [backups, export and import](docs/import-export.md).
Questions about lucid dreaming or the app: the Help / FAQ in **Learn** inside the app (its source: [faq.md](packages/knowledge/content/faq/faq.md)).

## Status

Under construction, no release yet. What is built and what is left: [STATUS.md](STATUS.md). Design: [PLAN.md](PLAN.md).
The evidence behind the course and the Learn articles: [RESEARCH.md](RESEARCH.md).

## Security in short

- The journal is sealed: dream text and every personal field are encrypted on your device before they are stored or synced.
- App lock on every device; nothing shows behind the lock screen.
- Two-factor sign-in and a recovery key.
- Nothing leaves your own server except an optional check for a newer version. The full audit, with the limits: [docs/security.md](docs/security.md).
- The honest limit: if you lose the password and the recovery key and have no signed-in device, nobody can read your journal. That is the point.

## Development

[docs/development.md](docs/development.md)

## License

[PolyForm Noncommercial 1.0.0](LICENSE): free for personal and other noncommercial use.
