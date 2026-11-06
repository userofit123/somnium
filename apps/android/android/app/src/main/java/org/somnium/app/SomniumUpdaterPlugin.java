package org.somnium.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.net.ConnectivityManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

/**
 * In-app updates from GitHub Releases: downloads the new APK into the app's cache, checks its SHA-256 against the
 * release's android-latest.json, and hands it to Android's installer (which always asks the person to confirm).
 * While it downloads, a notification shows how far it is (so leaving the app doesn't hide it), then that it's ready or
 * that it failed; a tap opens Settings, App & Versions, where Install is. The downloaded file is remembered here (not
 * only in the page), so after Android closes the app that page still offers Install instead of downloading again.
 */
@CapacitorPlugin(name = "SomniumUpdater")
public class SomniumUpdaterPlugin extends Plugin {
    // its own channel, so updates can be silenced in the phone's settings without touching the workout ones; low
    // importance: a progress bar that changes every second must not sound or pop up
    private static final String CHANNEL = "updates";
    private static final int ID = 7005;
    // the file that's ready and its version, kept across the app being closed (see staged())
    private static final String PREFS = "somnium-updater", K_PATH = "path", K_VERSION = "version";
    // a download is running. Static: the plugin object is rebuilt with the screen, a download must outlive that object
    // without a second one starting beside it. Set false when the app is closed so the download stops unseen.
    private static final AtomicBoolean DOWNLOADING = new AtomicBoolean(false);
    // each download has its own number; a thread whose number is no longer current has been superseded or closed and
    // must not touch the notification, the flag or the file of a newer download
    private static final AtomicLong GEN = new AtomicLong(0);

    // The app is closed (swiped away) mid-download: the download stops with it, so its ongoing notification would stay
    // forever with a bar that never moves. It goes, and the partial file is thrown away by the download itself.
    @Override
    protected void handleOnDestroy() {
        if (DOWNLOADING.getAndSet(false)) {
            GEN.incrementAndGet();
            NotificationManagerCompat.from(getContext().getApplicationContext()).cancel(ID);
        }
        super.handleOnDestroy();
    }

    private SharedPreferences prefs() { return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    @SuppressWarnings("deprecation")
    private static long code(PackageInfo pi) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? pi.getLongVersionCode() : pi.versionCode;
    }

    private long installedCode() {
        try { return code(getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0)); }
        catch (Exception e) { return Long.MAX_VALUE; } // unknown: nothing counts as newer
    }

    /** Whether the connection now is metered (mobile data, or a Wi-Fi Android counts as metered, like a phone's
     *  hotspot), for "Only on Wi-Fi": automatic downloads wait until it isn't. */
    @PluginMethod
    public void metered(PluginCall call) {
        ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        JSObject r = new JSObject();
        r.put("metered", cm != null && cm.isActiveNetworkMetered());
        call.resolve(r);
    }

    /** The ready update is out of date (a newer release exists): its file is deleted and forgotten. Never while a
     *  download is writing. */
    @PluginMethod
    public void discard(PluginCall call) {
        if (!DOWNLOADING.get()) {
            String path = prefs().getString(K_PATH, null);
            if (path != null) new File(path).delete();
            prefs().edit().clear().apply();
        }
        call.resolve();
    }

    /** The update downloaded earlier, if it's still there, is really that version, and isn't the one installed now:
     *  {path, version}, or nothing. Anything else is forgotten (and its file deleted). */
    @PluginMethod
    public void staged(PluginCall call) {
        SharedPreferences sp = prefs();
        String path = sp.getString(K_PATH, null), version = sp.getString(K_VERSION, null);
        JSObject r = new JSObject();
        if (path != null && version != null) {
            File f = new File(path);
            PackageInfo pi = f.isFile() ? getContext().getPackageManager().getPackageArchiveInfo(path, 0) : null;
            // it must be newer than what runs now (by version code), not merely different
            if (pi != null && version.equals(pi.versionName) && getContext().getPackageName().equals(pi.packageName) && code(pi) > installedCode()) {
                r.put("path", path);
                r.put("version", version);
                call.resolve(r);
                return;
            }
            f.delete();
        }
        sp.edit().clear().apply();
        call.resolve(r);
    }

    private void channel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "App updates", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("A new version of Somnium while it downloads");
            ch.setShowBadge(false);
            ((NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE)).createNotificationChannel(ch);
        }
    }

    /** The download's notification. `pct` 0-100, or -1 while the size is unknown (a moving bar); `busy` false when done
     *  or failed (no bar, and it can be swiped away). */
    private void notice(Context ctx, String title, String text, int pct, boolean busy) {
        Intent open = new Intent(ctx, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        open.putExtra(SomniumWorkoutPlugin.EXTRA_PATH, "/settings/versions");
        // its own request code, so this intent's page never ends up on another notification's tap
        PendingIntent pi = PendingIntent.getActivity(ctx, 3, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(busy ? android.R.drawable.stat_sys_download : R.drawable.ic_stat_somnium)
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(busy)
            .setAutoCancel(!busy)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setContentIntent(pi);
        // while it runs, it also goes by itself if nothing updates it for two minutes: if Android ends the app without
        // warning (no handleOnDestroy), nothing is left behind claiming a download that stopped
        if (busy) b.setProgress(100, Math.max(0, pct), pct < 0).setTimeoutAfter(120_000);
        try { NotificationManagerCompat.from(ctx).notify(ID, b.build()); } catch (SecurityException e) { /* notifications not allowed */ }
    }

    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url");
        String sha = call.getString("sha256");
        if (url == null) { call.reject("No download address"); return; }
        channel();
        String version = call.getString("version", "");
        String title = ("Downloading Somnium " + version).trim();
        if (!DOWNLOADING.compareAndSet(false, true)) { call.reject("Already downloading"); return; }
        final long gen = GEN.incrementAndGet();
        // the application context lives as long as the process; the activity's may be gone when the thread wakes
        final Context ctx = getContext().getApplicationContext();
        // the file about to be written is no longer the ready one
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply();
        // each download has its own file, so an old thread can never delete what a newer one is writing
        File[] old = ctx.getCacheDir().listFiles((d, n) -> n.startsWith("somnium-update") && n.endsWith(".apk"));
        if (old != null) for (File o : old) o.delete();
        final File out = new File(ctx.getCacheDir(), "somnium-update-" + gen + ".apk");
        notice(ctx, title, "Starting", -1, true);
        new Thread(() -> {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setInstanceFollowRedirects(true);
                // a connection that goes quiet fails the download instead of leaving it (and its notification) hanging
                c.setConnectTimeout(30_000);
                c.setReadTimeout(60_000);
                MessageDigest md = MessageDigest.getInstance("SHA-256");
                try (InputStream in = c.getInputStream(); FileOutputStream fo = new FileOutputStream(out)) {
                    byte[] buf = new byte[65536];
                    int n;
                    long total = c.getContentLengthLong(), done = 0, last = 0, lastNotice = 0;
                    while ((n = in.read(buf)) > 0) {
                        // the app was closed (or this download replaced): stop here
                        if (GEN.get() != gen) throw new InterruptedException("closed");
                        fo.write(buf, 0, n); md.update(buf, 0, n); done += n;
                        // tell the page how far it is, at most four times a second
                        long now = System.currentTimeMillis();
                        if (now - last >= 250) {
                            last = now;
                            JSObject p = new JSObject();
                            p.put("loaded", done); p.put("total", total);
                            notifyListeners("progress", p);
                        }
                        // the notification once a second: Android drops updates that come faster
                        if (GEN.get() == gen && now - lastNotice >= 1000) {
                            lastNotice = now;
                            if (total > 0) { int pct = (int) (done * 100 / total); notice(ctx, title, pct + "%", pct, true); }
                            else notice(ctx, title, String.format(java.util.Locale.ROOT, "%.1f MB", done / 1e6), -1, true);
                        }
                    }
                }
                StringBuilder hex = new StringBuilder();
                for (byte b : md.digest()) hex.append(String.format("%02x", b));
                if (GEN.get() != gen) throw new InterruptedException("closed");
                if (sha != null && !sha.isEmpty() && !sha.equalsIgnoreCase(hex.toString())) {
                    out.delete();
                    if (GEN.compareAndSet(gen, gen + 1)) DOWNLOADING.set(false);
                    notice(ctx, "Update failed", "The download was damaged. Tap to try again.", 0, false);
                    call.reject("The download was damaged. Try again.");
                    return;
                }
                JSObject r = new JSObject();
                r.put("path", out.getAbsolutePath());
                ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(K_PATH, out.getAbsolutePath()).putString(K_VERSION, version).apply();
                if (GEN.compareAndSet(gen, gen + 1)) DOWNLOADING.set(false);
                notice(ctx, "Update ready to install", "Tap to open App & Versions, then Install", 0, false);
                call.resolve(r);
            } catch (InterruptedException e) {
                out.delete(); // its own file: no newer download writes here
                call.reject("The app was closed during the download");
            } catch (Exception e) {
                out.delete();
                // false: the app was closed (or a newer download took over) and the notification is already gone
                boolean shown = GEN.compareAndSet(gen, gen + 1);
                if (shown) { DOWNLOADING.set(false); notice(ctx, "Update failed", "The download didn't finish. Tap to try again.", 0, false); }
                call.reject("Download failed: " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void install(PluginCall call) {
        String path = call.getString("path");
        if (path == null) { call.reject("Nothing downloaded"); return; }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getContext().getPackageManager().canRequestPackageInstalls()) {
            // first time: Android needs "Install unknown apps" allowed for Somnium
            Intent s = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            s.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(s);
            call.reject("Allow Somnium to install updates, then tap Install again");
            return;
        }
        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", new File(path));
        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setDataAndType(uri, "application/vnd.android.package-archive");
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        NotificationManagerCompat.from(getContext()).cancel(ID); // done with: Android's installer takes over
        // the file stays remembered: if the person backs out of Android's installer, Install still works next time;
        // once the new version runs, staged() sees it's installed and forgets it
        call.resolve();
    }
}
