package org.somnium.app;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.security.keystore.UserNotAuthenticatedException;
import android.util.Base64;
import android.view.WindowManager;
import androidx.activity.result.ActivityResult;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.security.KeyStore;
import java.util.Arrays;
import javax.crypto.AEADBadTagException;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * The app lock's device verification on Android (LDJ-9, PLAN.md §4.3) and the key a signed-in phone holds (LDJ-10, §4.4).
 *
 * The journal's data key is wrapped here by an AES-256-GCM key that lives in the Android Keystore and is bound to the
 * person: it only works after the fingerprint, face or screen lock. On Android 11 and newer every single use needs that
 * proof, carried by a CryptoObject through BiometricPrompt ("biometric or screen lock" in one window, as Money Manager's
 * AppLock asks). Before Android 11 a Keystore key can't take the screen lock through a CryptoObject, so the key works for
 * a few seconds after a strong biometric or the phone's own confirm-your-PIN screen. Below Android 6 there is no such
 * key, and the app unlocks with the password.
 *
 * The data key passes through Java only inside wrap() and unwrap() and is zeroed there (the base64 text the bridge
 * carries can't be zeroed; it is garbage the moment the call ends). The wrapped blob goes back to the page, which keeps
 * it in the account's record; nothing here stores it. A cancelled prompt is "cancelled" and never counted as a wrong try.
 *
 * Also: FLAG_SECURE (blank recents thumbnail, no screenshots) on by default, and the app's comings and goings for the
 * page's lock, which already waits out the chosen delay. "away" is sent only once the app is really out of sight
 * (onStop), stamped with the moment it began to leave (onPause): a permission dialog or this plugin's own prompt pauses
 * the app without leaving it and must not lock it, and the page's own visibility events then agree with these.
 */
@CapacitorPlugin(name = "SomniumLock")
public class SomniumLockPlugin extends Plugin {
    private static final String STORE = "AndroidKeyStore";
    private static final String PREFS = "somnium.privacy";
    private static final String TRANSFORM = "AES/GCM/NoPadding";
    private static final int IV_BYTES = 12;
    private static final boolean PER_USE = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R;
    private static final int STRONG = BiometricManager.Authenticators.BIOMETRIC_STRONG;
    private static final int CREDENTIAL = BiometricManager.Authenticators.DEVICE_CREDENTIAL;
    private static final int B64 = Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING;
    private boolean prompting = false;
    private long pausedAt = 0;
    private boolean away = false;

    // ----- screenshots and the recents thumbnail -----
    static boolean screenshotsAllowed(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("allowScreenshots", false); }
    /** MainActivity calls this before anything is drawn, so even the first frame is kept out of screenshots. */
    static void applySecure(Activity a) {
        if (screenshotsAllowed(a)) a.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
        else a.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
    }

    @PluginMethod
    public void screenshotsAllowed(PluginCall call) {
        JSObject r = new JSObject(); r.put("allowed", screenshotsAllowed(getContext())); call.resolve(r);
    }

    @PluginMethod
    public void setScreenshotsAllowed(PluginCall call) {
        boolean allowed = Boolean.TRUE.equals(call.getBoolean("allowed", false));
        SharedPreferences p = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        p.edit().putBoolean("allowScreenshots", allowed).apply();
        Activity a = getActivity();
        a.runOnUiThread(() -> applySecure(a));
        JSObject r = new JSObject(); r.put("allowed", allowed); call.resolve(r);
    }

    // ----- leaving and coming back -----
    @Override
    protected void handleOnPause() { if (!prompting) pausedAt = System.currentTimeMillis(); }

    @Override
    protected void handleOnStop() {
        if (prompting || pausedAt == 0) return;
        away = true;
        JSObject e = new JSObject(); e.put("at", pausedAt); notifyListeners("away", e);
    }

    @Override
    protected void handleOnResume() {
        pausedAt = 0;
        if (!away) return;
        away = false;
        JSObject e = new JSObject(); e.put("at", System.currentTimeMillis()); notifyListeners("back", e);
    }

    // ----- verification -----
    private KeyguardManager keyguard() { return (KeyguardManager) getContext().getSystemService(Context.KEYGUARD_SERVICE); }
    private boolean canUse() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return false;
        if (PER_USE) return BiometricManager.from(getContext()).canAuthenticate(STRONG | CREDENTIAL) == BiometricManager.BIOMETRIC_SUCCESS;
        return keyguard().isDeviceSecure();
    }

    /** Whether this phone can keep the key behind its own verification (a screen lock is set). */
    @PluginMethod
    public void available(PluginCall call) {
        JSObject r = new JSObject(); r.put("available", canUse()); r.put("perUse", PER_USE); call.resolve(r);
    }

    /** Just the verification, nothing unwrapped. */
    @PluginMethod
    public void prompt(PluginCall call) {
        if (!canUse()) { call.reject("This phone has no screen lock", "unavailable"); return; }
        verify(call, null);
    }

    /** { id, dataKey } → { blob }: a fresh Keystore key for this account wraps the data key, after the verification.
     *  The new key is made under an alias of its own and only becomes this account's once the verification passed and
     *  the wrap worked (commitKey): a cancelled prompt leaves the key that opens the blob already stored untouched. */
    @PluginMethod
    public void wrap(PluginCall call) {
        String id = call.getString("id"), dataKey = call.getString("dataKey");
        if (!validId(id) || dataKey == null) { call.reject("Bad request", "bad"); return; }
        if (!canUse()) { call.reject("This phone has no screen lock", "unavailable"); return; }
        try {
            dropKeys(id, true); // what an earlier wrap that was never finished left
            String next = alias(id) + "." + System.currentTimeMillis();
            call.getData().put(PENDING, next); // set here, whatever the page sent under that name
            newKey(next);
            verify(call, PER_USE ? cipherFor(call) : null);
        } catch (Exception e) { fail(call, e); }
    }

    /** { id, blob } → { dataKey }, after the verification. */
    @PluginMethod
    public void unwrap(PluginCall call) {
        String id = call.getString("id"), blob = call.getString("blob");
        if (!validId(id) || blob == null) { call.reject("Bad request", "bad"); return; }
        if (!canUse()) { call.reject("This phone has no screen lock", "unavailable"); return; }
        try { verify(call, PER_USE ? cipherFor(call) : null); } catch (Exception e) { fail(call, e); }
    }

    /** { id }: this account's Keystore key goes (device verification turned off, or signed out). */
    @PluginMethod
    public void forget(PluginCall call) {
        String id = call.getString("id");
        if (!validId(id)) { call.reject("Bad request", "bad"); return; }
        try { dropKeys(id, false); getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(CURRENT + id).apply(); call.resolve(); }
        catch (Exception e) { call.reject("Couldn't remove the key", "failed"); }
    }

    // which Keystore alias holds this account's key now: the plain one (older versions), or the last committed wrap's
    private static final String CURRENT = "lock.alias.", PENDING = "_pendingAlias";
    private String currentAlias(String id) { return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(CURRENT + id, alias(id)); }
    /** The alias this call uses: a wrap's own new one, an unwrap's the account's current one. */
    private String aliasOf(PluginCall call) {
        return call.getString("dataKey") != null ? call.getString(PENDING) : currentAlias(call.getString("id"));
    }
    /** The wrap worked: its new key becomes the account's, and the one before it goes. */
    private void commitKey(PluginCall call) throws Exception {
        String id = call.getString("id"), next = call.getString(PENDING);
        if (next == null) return;
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(CURRENT + id, next).commit();
        dropKeys(id, true);
    }
    /** This account's keys (the plain alias and every "alias.n"); keepCurrent: all but the one in use. */
    private void dropKeys(String id, boolean keepCurrent) throws Exception {
        KeyStore ks = KeyStore.getInstance(STORE); ks.load(null);
        String base = alias(id), cur = currentAlias(id);
        for (String a : java.util.Collections.list(ks.aliases())) {
            if (!(a.equals(base) || a.startsWith(base + "."))) continue;
            if (keepCurrent && a.equals(cur)) continue;
            ks.deleteEntry(a);
        }
    }

    private static boolean validId(String id) { return id != null && id.matches("[A-Za-z0-9_-]{1,64}"); }
    private static String alias(String id) { return "somnium.lock." + id; }

    private static void newKey(String alias) throws Exception {
        KeyGenParameterSpec.Builder b = new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) b.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG | KeyProperties.AUTH_DEVICE_CREDENTIAL);
        else b.setUserAuthenticationValidityDurationSeconds(15);
        KeyGenerator g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, STORE);
        g.init(b.build());
        g.generateKey();
    }

    /** The cipher for this call: encrypting for wrap (the Keystore makes the IV), decrypting with the blob's IV for unwrap. */
    private Cipher cipherFor(PluginCall call) throws Exception {
        KeyStore ks = KeyStore.getInstance(STORE); ks.load(null);
        String a = aliasOf(call);
        SecretKey key = a == null ? null : (SecretKey) ks.getKey(a, null);
        if (key == null) throw new KeyPermanentlyInvalidatedException("No key");
        Cipher c = Cipher.getInstance(TRANSFORM);
        if (call.getString("dataKey") != null) c.init(Cipher.ENCRYPT_MODE, key);
        else {
            byte[] blob = Base64.decode(call.getString("blob"), B64);
            if (blob.length <= IV_BYTES) throw new AEADBadTagException("Too short");
            c.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, blob, 0, IV_BYTES));
        }
        return c;
    }

    /** Asks for the fingerprint, face or screen lock, then carries out the call. cipher: Android 11+ (per use), else null. */
    private void verify(PluginCall call, Cipher cipher) {
        FragmentActivity act = (FragmentActivity) getActivity();
        act.runOnUiThread(() -> {
            boolean strongBio = BiometricManager.from(act).canAuthenticate(STRONG) == BiometricManager.BIOMETRIC_SUCCESS;
            if (!PER_USE && !strongBio) { screenLock(call); return; }
            prompting = true;
            BiometricPrompt p = new BiometricPrompt(act, ContextCompat.getMainExecutor(act), new BiometricPrompt.AuthenticationCallback() {
                @Override
                public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                    prompting = false;
                    BiometricPrompt.CryptoObject o = result.getCryptoObject();
                    finish(call, o != null ? o.getCipher() : null);
                }
                @Override
                public void onAuthenticationError(int code, CharSequence msg) {
                    prompting = false;
                    // before Android 11 the button beside the fingerprint is the way to the screen lock
                    if (code == BiometricPrompt.ERROR_NEGATIVE_BUTTON && !PER_USE && keyguard().isDeviceSecure()) { screenLock(call); return; }
                    if (code == BiometricPrompt.ERROR_LOCKOUT || code == BiometricPrompt.ERROR_LOCKOUT_PERMANENT) call.reject("Too many tries on this phone. Use your password, or wait.", "lockout");
                    else call.reject("Verification was cancelled", "cancelled");
                }
            });
            BiometricPrompt.PromptInfo.Builder info = new BiometricPrompt.PromptInfo.Builder().setTitle("Unlock Somnium").setSubtitle("Your journal opens after this");
            if (PER_USE) info.setAllowedAuthenticators(STRONG | CREDENTIAL);
            else info.setAllowedAuthenticators(STRONG).setNegativeButtonText(keyguard().isDeviceSecure() ? "Use screen lock" : "Cancel");
            if (cipher != null) p.authenticate(info.build(), new BiometricPrompt.CryptoObject(cipher));
            else p.authenticate(info.build());
        });
    }

    /** Before Android 11: the phone's own confirm-your-PIN screen, which opens the key for a few seconds. */
    @SuppressWarnings("deprecation")
    private void screenLock(PluginCall call) {
        Intent i = keyguard().createConfirmDeviceCredentialIntent("Unlock Somnium", "Your journal opens after this");
        if (i == null) { call.reject("This phone has no screen lock", "unavailable"); return; }
        prompting = true;
        startActivityForResult(call, i, "screenLockDone");
    }

    @ActivityCallback
    private void screenLockDone(PluginCall call, ActivityResult result) {
        prompting = false;
        if (call == null) return;
        if (result.getResultCode() == Activity.RESULT_OK) finish(call, null);
        else call.reject("Verification was cancelled", "cancelled");
    }

    /** After the verification: wrap or unwrap with the authorised cipher (or one made now, inside the time window). */
    private void finish(PluginCall call, Cipher authorised) {
        String dataKey = call.getString("dataKey"), blob = call.getString("blob");
        if (dataKey == null && blob == null) { call.resolve(); return; } // prompt(): nothing to open
        byte[] key = null, packed = null;
        try {
            Cipher c = authorised != null ? authorised : cipherFor(call);
            JSObject r = new JSObject();
            if (dataKey != null) {
                key = Base64.decode(dataKey, B64);
                byte[] ct = c.doFinal(key), iv = c.getIV();
                packed = new byte[iv.length + ct.length];
                System.arraycopy(iv, 0, packed, 0, iv.length);
                System.arraycopy(ct, 0, packed, iv.length, ct.length);
                r.put("blob", Base64.encodeToString(packed, B64));
                commitKey(call);
            } else {
                byte[] all = Base64.decode(blob, B64);
                key = c.doFinal(all, IV_BYTES, all.length - IV_BYTES);
                r.put("dataKey", Base64.encodeToString(key, B64));
            }
            call.resolve(r);
        } catch (Exception e) { fail(call, e); }
        finally { if (key != null) Arrays.fill(key, (byte) 0); }
    }

    private void fail(PluginCall call, Exception e) {
        // a new fingerprint or a removed screen lock ends the key for good; the page drops its blob and uses the password
        if (e instanceof KeyPermanentlyInvalidatedException) { call.reject("This phone's screen lock or fingerprints changed. Use your password, then turn device verification on again.", "invalidated"); return; }
        // the blob doesn't open with this key: altered, or from another key. The page counts this like a wrong password.
        if (e instanceof AEADBadTagException) { call.reject("This phone couldn't open your journal", "wrong"); return; }
        // the few seconds after the screen lock ran out (before Android 11): ask again, not counted
        if (e instanceof UserNotAuthenticatedException) { call.reject("Verification was cancelled", "cancelled"); return; }
        call.reject("This phone couldn't use its key", "failed");
    }
}
