package org.somnium.app;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Reminders on Android (PLAN.md §9, LDJ-29 and LDJ-30). The web app works out the plan (packages/shared/src/reminders.ts,
 * the same on every device) and hands the coming week of it here with the words (apps/web/src/native/reminders.ts).
 * Each item is an exact alarm (Fire), which shows its notification at that time with the app closed and the phone
 * asleep. The plan is kept in this app's own storage, so after a restart (Boot) the alarms are set again without the
 * web app, the network or the journal's key.
 *
 * A reality check's buttons (Awake, Not sure, Dreaming!) log the check without opening the app (Action): it waits in a
 * small queue here, and the web app posts it through the same locked-safe path as /check (no note, nothing sealed) the
 * next time it is open (pending, ack). Every other tap or button opens the app on its page (SomniumUpdaterPlugin's
 * "open" event, which the web app routes).
 *
 * The lock rules (CLAUDE.md): the words are generic, never dream text, and a locked screen shows only the public
 * version, "Reality check" or "Bedtime" with no text. The WBTB alarm is a real alarm: its own channel with the alarm
 * sound, set as an alarm clock (on time in Doze, shown in the status bar), ringing until dismissed or 10 minutes pass.
 */
@CapacitorPlugin(name = "SomniumReminders")
public class SomniumRemindersPlugin extends Plugin {
    static final String PREFS = "somnium_reminders";
    private static final String KEY_PLAN = "plan", KEY_ARMED = "armed", KEY_QUEUE = "queue";
    private static final int ALARM_BASE = 42000, MAX = 400, QUEUE_MAX = 200;
    static final String CH_RC = "reality_checks", CH_NIGHT = "night", CH_ALARM = "wbtb_alarm";
    private static final String ACTION_FIRE = "org.somnium.app.REMINDER_FIRE", ACTION_CHECK = "org.somnium.app.REMINDER_CHECK";
    private static final Object LOCK = new Object();

    private static final String EXTRA_NOTICE = "somniumNotice";

    // the app opened from a notification or one of its buttons: that notification goes (and the alarm stops)
    @Override
    public void load() {
        if (getActivity() != null) dismissFrom(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        dismissFrom(intent);
    }

    private void dismissFrom(Intent intent) {
        int notice = intent == null ? 0 : intent.getIntExtra(EXTRA_NOTICE, 0);
        if (notice == 0) return;
        intent.removeExtra(EXTRA_NOTICE);
        NotificationManagerCompat.from(getContext()).cancel(notice);
    }

    private static SharedPreferences prefs(Context ctx) { return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    // one notification per kind: a new reality check takes the place of one left unanswered
    private static int noticeId(String kind) {
        switch (kind) {
            case "bedtime": return 7102;
            case "wbtb": return 7103;
            case "morning_journal": return 7104;
            case "practice": return 7105;
            default: return 7101;
        }
    }

    // ----- the plan -----

    /** The plan (`items`: [{ at, kind, title, body, lockTitle, url, channel, actions }]) in place of the one before;
     *  an empty list takes every alarm off. Answers how many are set and whether they are exact. */
    @PluginMethod
    public void schedule(PluginCall call) {
        Context ctx = getContext();
        JSArray items = call.getArray("items");
        JSONArray keep = new JSONArray();
        long now = System.currentTimeMillis();
        if (items != null) {
            for (int i = 0; i < items.length() && keep.length() < MAX; i++) {
                JSONObject it = items.optJSONObject(i);
                if (it == null || it.optLong("at", 0) < now - 60_000) continue;
                String url = appPath(it.optString("url", "/"));
                if (url == null) continue;
                try { it.put("url", url); } catch (JSONException e) { continue; }
                keep.put(it);
            }
        }
        int n;
        synchronized (LOCK) {
            prefs(ctx).edit().putString(KEY_PLAN, keep.toString()).apply();
            n = arm(ctx);
        }
        JSObject r = new JSObject();
        r.put("count", n);
        r.put("exact", exactAllowed(ctx));
        call.resolve(r);
    }

    static boolean exactAllowed(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.S || (am != null && am.canScheduleExactAlarms());
    }

    private static PendingIntent fireIntent(Context ctx, int i, long at, int flags) {
        Intent it = new Intent(ctx, Fire.class).setAction(ACTION_FIRE).putExtra("i", i).putExtra("at", at);
        return PendingIntent.getBroadcast(ctx, ALARM_BASE + i, it, PendingIntent.FLAG_IMMUTABLE | flags);
    }

    /** Takes off the alarms set before and sets one for every item of the stored plan still to come. */
    static int arm(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return 0;
        SharedPreferences p = prefs(ctx);
        int before = p.getInt(KEY_ARMED, 0);
        for (int i = 0; i < before && i < MAX; i++) {
            PendingIntent pi = fireIntent(ctx, i, 0, PendingIntent.FLAG_NO_CREATE);
            if (pi != null) { am.cancel(pi); pi.cancel(); }
        }
        JSONArray plan = plan(ctx);
        boolean exact = exactAllowed(ctx);
        long now = System.currentTimeMillis();
        int set = 0;
        for (int i = 0; i < plan.length(); i++) {
            JSONObject it = plan.optJSONObject(i);
            if (it == null) continue;
            long at = it.optLong("at", 0);
            if (at < now - 60_000) continue;
            PendingIntent pi = fireIntent(ctx, i, at, PendingIntent.FLAG_UPDATE_CURRENT);
            try {
                if (CH_ALARM.equals(it.optString("channel")) && exact) {
                    // an alarm clock: never deferred by Doze, and the status bar shows the alarm is set
                    am.setAlarmClock(new AlarmManager.AlarmClockInfo(at, openPath(ctx, it.optString("url", "/"), 9000 + i)), pi);
                } else if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) am.setExact(AlarmManager.RTC_WAKEUP, at, pi);
                else if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
                // without the exact-alarm permission (Android 12+ can take it away) it may come a little late, never not at all
                else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            } catch (SecurityException e) {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            }
            set++;
        }
        p.edit().putInt(KEY_ARMED, plan.length()).apply();
        return set;
    }

    private static JSONArray plan(Context ctx) {
        try { return new JSONArray(prefs(ctx).getString(KEY_PLAN, "[]")); } catch (JSONException e) { return new JSONArray(); }
    }

    // ----- permissions: notifications are asked through @capacitor/local-notifications; exact alarms here -----

    /** Whether exact alarms are allowed (Android 12+ lets the person switch them off for an app). */
    @PluginMethod
    public void exactAlarms(PluginCall call) {
        JSObject r = new JSObject();
        boolean ok = exactAllowed(getContext());
        r.put("allowed", ok);
        r.put("needsAsking", !ok);
        call.resolve(r);
    }

    /** Android's own page for this app's "Alarms and reminders" switch; Android 11 and older have none (always allowed). */
    @PluginMethod
    public void openExactAlarmSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            Intent it = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + getContext().getPackageName()));
            it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try { getContext().startActivity(it); } catch (Exception e) { /* no such page on this phone */ }
        }
        call.resolve();
    }

    // ----- the queue of checks logged from a notification -----

    /** The checks waiting to be posted: [{ id, at, check, outcome, account, user }]. They stay until acknowledged (ack):
     *  the web app posts each to its own account only, and drops an account's when it is removed. */
    @PluginMethod
    public void pending(PluginCall call) {
        JSObject r = new JSObject();
        synchronized (LOCK) { r.put("items", queue(getContext())); }
        call.resolve(r);
    }

    /** Drops the checks the web app has posted (or kept in its own outbox). */
    @PluginMethod
    public void ack(PluginCall call) {
        JSArray ids = call.getArray("ids");
        Set<String> gone = new HashSet<>();
        if (ids != null) for (int i = 0; i < ids.length(); i++) gone.add(ids.optString(i));
        synchronized (LOCK) {
            JSONArray q = queue(getContext()), left = new JSONArray();
            for (int i = 0; i < q.length(); i++) {
                JSONObject o = q.optJSONObject(i);
                if (o != null && !gone.contains(o.optString("id"))) left.put(o);
            }
            prefs(getContext()).edit().putString(KEY_QUEUE, left.toString()).apply();
        }
        call.resolve();
    }

    private static JSONArray queue(Context ctx) {
        try { return new JSONArray(prefs(ctx).getString(KEY_QUEUE, "[]")); } catch (JSONException e) { return new JSONArray(); }
    }

    // ----- showing one -----

    static void ensureChannels(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (nm.getNotificationChannel(CH_RC) == null) {
            NotificationChannel ch = new NotificationChannel(CH_RC, "Reality checks", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("A few times a day: are you dreaming?");
            ch.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
            nm.createNotificationChannel(ch);
        }
        if (nm.getNotificationChannel(CH_NIGHT) == null) {
            NotificationChannel ch = new NotificationChannel(CH_NIGHT, "Bedtime, morning and practice", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
            nm.createNotificationChannel(ch);
        }
        if (nm.getNotificationChannel(CH_ALARM) == null) {
            NotificationChannel ch = new NotificationChannel(CH_ALARM, "WBTB alarm", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Wakes you on nights you planned WBTB");
            ch.setSound(alarmSound(), new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
            ch.enableVibration(true);
            ch.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
            nm.createNotificationChannel(ch);
        }
    }

    private static Uri alarmSound() {
        Uri u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        return u != null ? u : RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
    }

    /** A page of this app: the address reduced to its path and query, as the web app and its service worker do.
     *  "//elsewhere" starts with "/" too, so a prefix test isn't enough. Null for anything that isn't one. */
    static String appPath(String u) {
        if (u == null || u.isEmpty()) return null;
        try {
            java.net.URI x = new java.net.URI("https", "app.invalid", "/", null).resolve(u);
            if (!"https".equals(x.getScheme()) || !"app.invalid".equals(x.getHost()) || x.getPort() != -1 || x.getRawUserInfo() != null) return null;
            String path = x.getRawPath() == null || x.getRawPath().isEmpty() ? "/" : x.getRawPath();
            return x.getRawQuery() == null ? path : path + "?" + x.getRawQuery();
        } catch (Exception e) { return null; }
    }

    /** Opens the app on a page (handed to the web app by SomniumUpdaterPlugin's "open" event). */
    static PendingIntent openPath(Context ctx, String path, int code) { return openPath(ctx, path, code, 0); }
    /** `notice`: the notification to take away once the app is open (a button doesn't, and the alarm would ring on). */
    static PendingIntent openPath(Context ctx, String path, int code, int notice) {
        Intent open = new Intent(ctx, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(SomniumUpdaterPlugin.EXTRA_PATH, path)
            .putExtra(EXTRA_NOTICE, notice);
        return PendingIntent.getActivity(ctx, code, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    static void show(Context ctx, JSONObject it) {
        ensureChannels(ctx);
        String kind = it.optString("kind", "reality_check"), channel = it.optString("channel", CH_RC);
        boolean alarm = CH_ALARM.equals(channel);
        int id = noticeId(kind);
        PendingIntent tap = openPath(ctx, it.optString("url", "/"), id * 8, id);
        // all a locked screen shows: one generic line, no text, the same buttons (they carry nothing personal)
        NotificationCompat.Builder pub = new NotificationCompat.Builder(ctx, channel)
            .setSmallIcon(R.drawable.ic_stat_somnium)
            .setContentTitle(it.optString("lockTitle", "Reality check"))
            .setContentIntent(tap);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, channel)
            .setSmallIcon(R.drawable.ic_stat_somnium)
            .setContentTitle(it.optString("title", "Are you dreaming?"))
            .setContentText(it.optString("body", ""))
            .setStyle(new NotificationCompat.BigTextStyle().bigText(it.optString("body", "")))
            .setAutoCancel(true)
            .setContentIntent(tap)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setCategory(alarm ? NotificationCompat.CATEGORY_ALARM : NotificationCompat.CATEGORY_REMINDER)
            .setPriority(alarm ? NotificationCompat.PRIORITY_MAX : NotificationCompat.PRIORITY_DEFAULT);
        if (alarm) {
            // before Android 8 (no channels) the sound is set on the notification
            b.setSound(alarmSound(), AudioManager.STREAM_ALARM).setVibrate(new long[] { 0, 800, 400, 800 }).setTimeoutAfter(10 * 60_000);
            pub.setTimeoutAfter(10 * 60_000);
        } else b.setDefaults(NotificationCompat.DEFAULT_ALL);
        JSONArray actions = it.optJSONArray("actions");
        if (actions != null) {
            for (int k = 0; k < actions.length() && k < 3; k++) {
                JSONObject a = actions.optJSONObject(k);
                if (a == null) continue;
                PendingIntent pi;
                String outcome = a.optString("outcome", "");
                if (!outcome.isEmpty()) {
                    Intent log = new Intent(ctx, Action.class).setAction(ACTION_CHECK)
                        .putExtra("check", a.optString("check", "")).putExtra("outcome", outcome).putExtra("notice", id)
                        // whose check it is: the web app posts it to that account only (flushPending)
                        .putExtra("account", a.optString("account", "")).putExtra("user", a.optString("user", ""));
                    pi = PendingIntent.getBroadcast(ctx, id * 8 + 1 + k, log, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
                } else {
                    String url = appPath(a.optString("url", ""));
                    if (url == null) continue;
                    pi = openPath(ctx, url, id * 8 + 1 + k, id);
                }
                b.addAction(0, a.optString("title", ""), pi);
                pub.addAction(0, a.optString("title", ""), pi);
            }
        }
        b.setPublicVersion(pub.build());
        Notification n = b.build();
        if (alarm) n.flags |= Notification.FLAG_INSISTENT; // rings until it is answered or swiped away (or times out)
        try { NotificationManagerCompat.from(ctx).notify(id, n); } catch (SecurityException e) { /* notifications not allowed */ }
    }

    /** An alarm come due: the item it was set for, if the plan still holds it at that time. Something more than
     *  15 minutes late (the phone was off) is skipped, as on the web and desktop. */
    public static class Fire extends BroadcastReceiver {
        @Override
        public void onReceive(Context ctx, Intent intent) {
            int i = intent.getIntExtra("i", -1);
            long at = intent.getLongExtra("at", -1);
            JSONObject it;
            synchronized (LOCK) { it = plan(ctx).optJSONObject(i); }
            if (it == null || it.optLong("at", 0) != at) return;
            if (System.currentTimeMillis() - at > 15 * 60_000) return;
            show(ctx, it);
        }
    }

    /** Awake / Not sure / Dreaming! on a reality check: the check goes into the queue, the notification goes away. */
    public static class Action extends BroadcastReceiver {
        @Override
        public void onReceive(Context ctx, Intent intent) {
            String check = intent.getStringExtra("check"), outcome = intent.getStringExtra("outcome");
            String account = intent.getStringExtra("account"), user = intent.getStringExtra("user");
            if (outcome == null || !(outcome.equals("awake") || outcome.equals("unsure") || outcome.equals("dreaming"))) return;
            synchronized (LOCK) {
                JSONArray q = queue(ctx), next = new JSONArray();
                // the newest QUEUE_MAX: a phone never opened for weeks doesn't grow this without end
                for (int i = Math.max(0, q.length() - QUEUE_MAX + 1); i < q.length(); i++) next.put(q.opt(i));
                try {
                    next.put(new JSONObject()
                        .put("id", UUID.randomUUID().toString())
                        .put("at", System.currentTimeMillis())
                        .put("check", check == null ? "" : check)
                        .put("outcome", outcome)
                        .put("account", account == null ? "" : account)
                        .put("user", user == null ? "" : user));
                } catch (JSONException e) { return; }
                prefs(ctx).edit().putString(KEY_QUEUE, next.toString()).apply();
            }
            NotificationManagerCompat.from(ctx).cancel(intent.getIntExtra("notice", noticeId("reality_check")));
        }
    }

    /** After a restart, an app update, a changed clock or exact alarms switched back on: the alarms again, from the
     *  last plan. No network and no key: the plan holds only times and generic words. */
    public static class Boot extends BroadcastReceiver {
        @Override
        public void onReceive(Context ctx, Intent intent) {
            synchronized (LOCK) { arm(ctx); }
        }
    }
}
