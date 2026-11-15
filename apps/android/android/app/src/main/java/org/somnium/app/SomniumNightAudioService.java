package org.somnium.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

/**
 * Night practice tones with the screen off (LDJ-115): SSILD's step tones, WILD's phase tones, sound cue training's
 * cues in sleep and the "back to bed" tone after WBTB. The web screens work out the schedule (packages/shared
 * guided.ts) and hand it over through SomniumNightAudioPlugin; this foreground service plays it while the phone sleeps
 * and stops by itself after the last tone (and never runs past MAX_MS).
 *
 * The tones are made here, as the web app makes them with WebAudio: a soft sine or triangle note with a slow attack and
 * a long fade, mixed into a short PCM buffer. No audio files are bundled, so there is no licence to track, and nothing
 * touches the network.
 *
 * The lock rules (CLAUDE.md): the notification Android requires is generic ("Night practice running", a Stop button)
 * and says nothing about the journal or the practice. No audio focus is asked for, so a white-noise or music app the
 * person sleeps with keeps playing; the tones are on the media volume.
 *
 * A partial wake lock holds the CPU for the schedule's length: without it the phone's deep sleep would stall the timer
 * and play the tones late. That costs some battery on a long sound cue window; the screen stays off.
 */
public class SomniumNightAudioService extends Service {
    static final String ACTION_START = "org.somnium.app.NIGHT_AUDIO_START", ACTION_STOP = "org.somnium.app.NIGHT_AUDIO_STOP";
    private static final String CHANNEL = "night_practice";
    private static final int NOTICE_ID = 43001;
    /** the longest a schedule may run: a whole night */
    static final long MAX_MS = 12L * 3_600_000L;
    /** a tone more than this late (the phone was busy) is skipped, so a delay never turns into a burst */
    private static final long LATE_MS = 5_000;
    private static final int RATE = 44_100;
    private static final double NOTE_GAP = 0.45, NOTE_LEN = 1.5, ATTACK = 0.12, FADE_END = 1.4;

    /** One schedule, handed over by the plugin in the same process (a whole night of cues is too big for an Intent). */
    static final class Schedule {
        final long[] at; final float[] gain; final double[][] notes; final boolean[] triangle; final long end;
        Schedule(long[] at, float[] gain, double[][] notes, boolean[] triangle, long end) {
            this.at = at; this.gain = gain; this.notes = notes; this.triangle = triangle; this.end = end;
        }
    }

    private static final Object LOCK = new Object();
    private static Schedule pending;
    static volatile boolean running;
    static volatile int played;
    private static int generation;

    private Thread worker;
    private PowerManager.WakeLock wake;
    private final Handler main = new Handler(Looper.getMainLooper());

    static void start(Context ctx, Schedule s) {
        synchronized (LOCK) { pending = s; }
        ContextCompat.startForegroundService(ctx, new Intent(ctx, SomniumNightAudioService.class).setAction(ACTION_START));
    }

    static void stop(Context ctx) {
        // not guarded by `running`: right after start() the service may not have reached onStartCommand yet, and a
        // schedule still pending would play after this Stop. Dropping it here and queueing a STOP covers both.
        synchronized (LOCK) { pending = null; }
        try { ctx.startService(new Intent(ctx, SomniumNightAudioService.class).setAction(ACTION_STOP)); }
        catch (RuntimeException ignored) { /* app in the background and no service running: nothing to stop */ }
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // startForegroundService needs startForeground soon after, whatever comes next
        goForeground();
        Schedule s;
        synchronized (LOCK) { s = pending; pending = null; }
        if (intent == null || ACTION_STOP.equals(intent.getAction()) || s == null) {
            finish();
            return START_NOT_STICKY;
        }
        // a new schedule replaces the one playing (the screen started again); the old one doesn't report an end
        int gen;
        synchronized (LOCK) { gen = ++generation; }
        stopWorker();
        played = 0;
        running = true;
        long end = Math.min(s.end, System.currentTimeMillis() + MAX_MS);
        holdAwake(end - System.currentTimeMillis() + 60_000);
        worker = new Thread(() -> {
            run(s, end);
            main.post(() -> { synchronized (LOCK) { if (gen != generation) return; } finish(); });
        }, "somnium-night-audio");
        worker.start();
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        stopWorker();
        releaseWake();
        if (running) { running = false; SomniumNightAudioPlugin.ended(played); }
        super.onDestroy();
    }

    private void finish() {
        stopWorker();
        releaseWake();
        boolean was = running;
        running = false;
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE); else stopForeground(true);
        stopSelf();
        if (was) SomniumNightAudioPlugin.ended(played);
    }

    private void stopWorker() {
        Thread w = worker;
        worker = null;
        if (w != null) w.interrupt();
    }

    private void holdAwake(long ms) {
        releaseWake();
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "somnium:night-audio");
        wake.setReferenceCounted(false);
        wake.acquire(Math.max(60_000, Math.min(ms, MAX_MS + 60_000)));
    }

    private void releaseWake() {
        PowerManager.WakeLock w = wake;
        wake = null;
        if (w != null && w.isHeld()) w.release();
    }

    // ----- the schedule -----
    private static void run(Schedule s, long end) {
        for (int i = 0; i < s.at.length; i++) {
            if (Thread.currentThread().isInterrupted()) return;
            long wait = s.at[i] - System.currentTimeMillis();
            if (wait < -LATE_MS) continue;
            // slept in short steps against the wall clock, so a changed clock or a long wait can't drift
            while (wait > 0) {
                try { Thread.sleep(Math.min(wait, 30_000)); } catch (InterruptedException e) { return; }
                wait = s.at[i] - System.currentTimeMillis();
            }
            if (System.currentTimeMillis() >= end) return;
            int r = play(s.notes[i], s.triangle[i], s.gain[i]);
            if (r < 0) return;
            played += r;
        }
    }

    /** One cue: its notes one after another, each with the web player's envelope. 1 played, 0 not (no output just
     *  then), -1 stopped meanwhile. */
    private static int play(double[] notes, boolean triangle, float gain) {
        if (notes.length == 0 || gain <= 0) return 0;
        int len = (int) Math.round((NOTE_GAP * (notes.length - 1) + NOTE_LEN) * RATE);
        float[] mix = new float[len];
        int noteLen = (int) Math.round(NOTE_LEN * RATE);
        double floor = Math.min(0.0001, gain / 2);
        for (int k = 0; k < notes.length; k++) {
            int off = (int) Math.round(k * NOTE_GAP * RATE);
            double w = 2 * Math.PI * notes[k];
            for (int j = 0; j < noteLen && off + j < len; j++) {
                double t = (double) j / RATE;
                double env = t < ATTACK ? gain * t / ATTACK
                    : t < FADE_END ? gain * Math.pow(floor / gain, (t - ATTACK) / (FADE_END - ATTACK)) : 0;
                double v = Math.sin(w * t);
                if (triangle) v = (2 / Math.PI) * Math.asin(v);
                mix[off + j] += (float) (env * v);
            }
        }
        short[] pcm = new short[len];
        for (int j = 0; j < len; j++) pcm[j] = (short) Math.max(-32767, Math.min(32767, Math.round(mix[j] * 32767)));
        AudioTrack track;
        try {
            track = new AudioTrack(
                new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build(),
                new AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(RATE).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build(),
                len * 2, AudioTrack.MODE_STATIC, AudioManager.AUDIO_SESSION_ID_GENERATE);
            track.write(pcm, 0, len);
            track.play();
        } catch (RuntimeException e) {
            return 0; // no audio output just now (a call, say): this cue is lost, the next one tries again
        }
        try {
            Thread.sleep((long) (1000 * len / (double) RATE) + 50);
            return 1;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return -1;
        } finally {
            try { track.stop(); } catch (RuntimeException ignored) { }
            track.release();
        }
    }

    // ----- the notification Android requires: generic, with Stop -----
    private void goForeground() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Night practice", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Shown while practice tones play with the screen off");
            ch.setSound(null, null);
            ch.enableVibration(false);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openPi = PendingIntent.getActivity(this, 43, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Intent stop = new Intent(this, SomniumNightAudioService.class).setAction(ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getService(this, 44, stop, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_somnium)
            .setContentTitle("Night practice running")
            .setContentIntent(openPi)
            .addAction(0, "Stop", stopPi)
            .setOngoing(true)
            .setSilent(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build();
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTICE_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(NOTICE_ID, n);
    }
}
