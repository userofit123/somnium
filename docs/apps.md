# Desktop and Android apps

Both apps work on their own (a **local account**: everything stays on the device) or with your server
(a **server account**: the data is on your Somnium server, sealed; the app keeps a copy on the device and works offline).
Both kinds can be added side by side and switched in Settings → Servers & accounts (on a phone: More → Servers & accounts). In a browser, the server is the site whose address you open.

## Install

From the [latest release](https://github.com/userofit123/somnium/releases/latest):

- **Android:** `somnium-x.y.z.apk`. Allow "Install unknown apps" for your browser or file manager when asked.
- **Linux:** `.AppImage`, `.deb` or `.rpm`.
- **Windows:** the `.exe` installer.

## Updates

- The apps check GitHub for a new version (Settings → App & Versions) and can download it automatically.
- Desktop: the update installs when you restart the app (or press Install).
- Android: Android always asks you to confirm an install; Somnium downloads the APK, checks it, and opens the installer.
  The first time, Android asks you to allow Somnium to install apps.
- Alternative for Android: [Obtainium](https://github.com/ImranR98/Obtainium) can follow the GitHub releases.

The repository has to be public for the apps to see new releases.

## Backups

- Desktop: to `Documents/Somnium Backups` (change it in Settings → Backup & restore).
- Android: to `Documents/Somnium` on the phone.
