package org.somnium.app;

import android.graphics.Color;
import android.os.Build;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The page runs behind clear status and navigation bars, so its background (with the look's glow at the top)
 * continues under the clock, the same as Money Manager. A flat bar colour can't do that: it would always be the
 * page's plain base colour, darker than the glowing top. The page pads itself by the bars' heights, which we hand
 * it as --nst / --nsb / --nsl / --nsr (see tokens.css), because older WebViews report no safe-area insets.
 * The clock and icons switch between dark and light with the look (the page tells us; see theme.ts).
 * Phones before Android 6 can't show dark status-bar icons, so they keep the bars coloured and the page below them.
 */
@CapacitorPlugin(name = "SomniumBars")
public class SomniumBarsPlugin extends Plugin {
    private static final boolean EDGE = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M;
    private int top, bottom, left, right;

    @Override
    public void load() {
        if (!EDGE) return;
        Window w = getActivity().getWindow();
        WindowCompat.setDecorFitsSystemWindows(w, false);
        w.setStatusBarColor(Color.TRANSPARENT);
        // dark navigation buttons need Android 8; before that the bar keeps a colour (set() below)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) w.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) { w.setStatusBarContrastEnforced(false); w.setNavigationBarContrastEnforced(false); }
        View web = getBridge().getWebView();
        ViewCompat.setOnApplyWindowInsetsListener(web, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            boolean typing = insets.isVisible(WindowInsetsCompat.Type.ime());
            // only the keyboard shrinks the page; every bar, the side ones in landscape too, is the page's to pad, so its
            // background fills the strip beside a side navigation bar instead of the window's plain colour showing there
            ViewGroup.MarginLayoutParams lp = (ViewGroup.MarginLayoutParams) v.getLayoutParams();
            int b = typing ? ime.bottom : 0;
            if (lp.leftMargin != 0 || lp.rightMargin != 0 || lp.bottomMargin != b) {
                lp.setMargins(0, 0, 0, b);
                v.setLayoutParams(lp);
            }
            float d = v.getResources().getDisplayMetrics().density;
            int t = Math.round(bars.top / d), bo = typing ? 0 : Math.round(bars.bottom / d);
            int l = Math.round(bars.left / d), r = Math.round(bars.right / d);
            if (t != top || bo != bottom || l != left || r != right) { top = t; bottom = bo; left = l; right = r; notifyListeners("insets", sizes()); }
            // newer WebViews turn the insets they get into env(safe-area-inset-*): take off the part the keyboard margin
            // already covers, so the bottom padding doesn't stay at the navigation bar's height while typing
            return ViewCompat.onApplyWindowInsets(v, b > 0 ? insets.inset(0, 0, 0, b) : insets);
        });
        ViewCompat.requestApplyInsets(web);
    }

    private JSObject sizes() {
        JSObject o = new JSObject();
        o.put("top", top);
        o.put("bottom", bottom);
        o.put("left", left);
        o.put("right", right);
        return o;
    }

    /** The bars' sizes (top, bottom and the sides) in CSS pixels, for a page that has just loaded. */
    @PluginMethod
    public void insets(PluginCall call) { call.resolve(sizes()); }

    @PluginMethod
    public void set(PluginCall call) {
        String bg = call.getString("bg");
        boolean dark = Boolean.TRUE.equals(call.getBoolean("dark", true));
        int parsed;
        try { parsed = Color.parseColor(bg); } catch (Exception e) { call.reject("Not a colour"); return; }
        final int c = parsed;
        getActivity().runOnUiThread(() -> {
            Window w = getActivity().getWindow();
            if (!EDGE) w.setStatusBarColor(c);
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) w.setNavigationBarColor(c);
            WindowInsetsControllerCompat ctl = new WindowInsetsControllerCompat(w, w.getDecorView());
            ctl.setAppearanceLightStatusBars(!dark);
            ctl.setAppearanceLightNavigationBars(!dark);
            call.resolve();
        });
    }
}
