package org.somnium.app;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Night practice tones with the screen off (LDJ-115): the bridge to SomniumNightAudioService. The web app
 * (apps/web/src/native/nightAudio.ts) hands over a schedule: cues of { at (ms), notes (Hz), wave, gain } and an end.
 * Only tones and times cross here, nothing from the journal. "ended" tells the web app when the service stopped by
 * itself or from its notification's Stop, with the count played.
 */
@CapacitorPlugin(name = "SomniumNightAudio")
public class SomniumNightAudioPlugin extends Plugin {
    private static SomniumNightAudioPlugin current;

    @Override
    public void load() { current = this; }

    @PluginMethod
    public void start(PluginCall call) {
        JSArray cues = call.getArray("cues");
        long end = call.getLong("end", 0L);
        if (cues == null || cues.length() == 0 || end <= System.currentTimeMillis()) { call.reject("Nothing to play"); return; }
        int n = cues.length();
        long[] at = new long[n]; float[] gain = new float[n]; double[][] notes = new double[n][]; boolean[] tri = new boolean[n];
        try {
            for (int i = 0; i < n; i++) {
                JSONObject c = cues.getJSONObject(i);
                at[i] = c.getLong("at");
                // the web app's gains are at most 0.04; held well under full scale whatever arrives
                gain[i] = (float) Math.max(0, Math.min(0.2, c.getDouble("gain")));
                tri[i] = "triangle".equals(c.optString("wave"));
                JSONArray ns = c.getJSONArray("notes");
                notes[i] = new double[Math.min(ns.length(), 4)];
                for (int k = 0; k < notes[i].length; k++) notes[i][k] = Math.max(40, Math.min(4000, ns.getDouble(k)));
            }
        } catch (JSONException e) { call.reject("Bad schedule"); return; }
        SomniumNightAudioService.start(getContext(), new SomniumNightAudioService.Schedule(at, gain, notes, tri, end));
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        SomniumNightAudioService.stop(getContext());
        call.resolve(state());
    }

    @PluginMethod
    public void status(PluginCall call) { call.resolve(state()); }

    private static JSObject state() {
        JSObject r = new JSObject();
        r.put("running", SomniumNightAudioService.running);
        r.put("played", SomniumNightAudioService.played);
        return r;
    }

    /** From the service, on the main thread: the schedule is over or was stopped. Kept until the web app listens. */
    static void ended(int played) {
        SomniumNightAudioPlugin p = current;
        if (p == null) return;
        JSObject r = new JSObject();
        r.put("played", played);
        p.notifyListeners("ended", r, true);
    }
}
