# Desktop and Android apps

Both apps work on their own (a **local account**: everything stays on the device) or with your server
(a **server account**: the data is on your Somnium server, sealed; the app keeps a copy on the device and works offline).
Both kinds can be added side by side and switched in Settings → Servers & accounts (on a phone: More → Servers & accounts). In a browser, the server is the site whose address you open.

## Install

Available with 0.1.0, from the [latest release](https://github.com/userofit123/somnium/releases/latest). Each release
lists `SHA256SUMS`: check a download with `sha256sum -c SHA256SUMS --ignore-missing` (Linux) or `Get-FileHash` (Windows).

- **Android:** `somnium-x.y.z.apk`. Allow "Install unknown apps" for your browser or file manager when asked. It is
  signed with one key for all versions, so updates install over the old app.
- **Linux:** `.AppImage` (make it executable and run it; it updates itself), `.deb` (`sudo apt install ./file.deb`) or
  `.rpm` (`sudo dnf install ./file.rpm`). The .deb and .rpm update through the app too, or by installing the new file.
- **Windows:** the `.exe` installer. Windows may show a "protected your PC" notice because the app is not code-signed;
  choose More info, then Run anyway.
- **Phone without an app:** open your server's address and choose Add to Home Screen (the PWA).

The first time, each app asks whether to keep the journal **on this device** or to **connect to your server**.

## The tray (desktop)

With "close to the tray" on (Settings → Notifications, on this computer), closing the window keeps Somnium running in
the tray (the notification area), so reminders still arrive, and the app is locked the moment the window closes. Click
the tray icon to open it; its menu can pause reminders for today and quit. Quit from the tray menu to stop reminders.
The same panel can start Somnium at login. Where the desktop has no tray, the setting is hidden and closing quits.

## Updates

- The apps check GitHub for a new version (Settings → App & Versions) and can download it automatically.
- Desktop: the update installs when you restart the app (or press Install).
- Android: Android always asks you to confirm an install; Somnium downloads the APK, checks it, and opens the installer.
  The first time, Android asks you to allow Somnium to install apps.
- Alternative for Android: [Obtainium](https://github.com/ImranR98/Obtainium). Add `https://github.com/userofit123/somnium`
  as the source and keep the default settings; it installs the release's `.apk` and tells you about new versions.
  Releases also carry `android-latest.json` (version, download address, SHA-256, size), which the app's own updater reads.

The repository has to be public for the apps to see new releases.

## Backups

- Desktop: to `Documents/Somnium Backups` (change it in Settings → Backup & restore).
- Android: to `Documents/Somnium` on the phone.
- Backups are encrypted files (`.somniumbackup`); see [import-export.md](import-export.md) for restoring and the other formats.

## Android permissions

Somnium asks only for what it uses:

- **INTERNET**: reaching your own Somnium server, and the optional update check on GitHub's public releases.
- **ACCESS_NETWORK_STATE**: tells whether the connection is metered, so "Only on Wi-Fi" update downloads can wait.
- **POST_NOTIFICATIONS** (Android 13 and later, asked): reminders (reality checks, bedtime, WBTB, morning) and the update
  download's progress. Notifications never contain dream text.
- **SCHEDULE_EXACT_ALARM** (Android 12) / **USE_EXACT_ALARM** (13 and later): reminders on time while the phone sleeps.
- **RECEIVE_BOOT_COMPLETED**: sets the reminders again after a restart, an app update or a clock change.
- **VIBRATE**: the alarm reminders' vibration on older Android versions.
- **WAKE_LOCK**: comes with the notifications library; Somnium's own reminders never keep the phone awake.
- **READ/WRITE_EXTERNAL_STORAGE** (Android 10 and earlier only, asked): writing backups to Documents/Somnium.
- **REQUEST_INSTALL_PACKAGES**: installing downloaded updates. Android asks once, Somnium explains why first, and every
  install still needs your confirmation.

Not used: location, camera, microphone (photos and voice notes use the system picker and recorder), contacts, accounts.
Android's own cloud backup and device-to-device transfer copy nothing of the app; use Somnium's backups instead.

**Your server over https only.** The Android app never uses plain http. A server on your home network needs an https
certificate. If it comes from a private authority (Caddy's internal CA, mkcert), install that CA certificate on the
phone: Settings → Security → Encryption & credentials → Install a certificate → CA certificate.
