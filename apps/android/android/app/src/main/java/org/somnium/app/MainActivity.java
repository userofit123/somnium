package org.somnium.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SomniumUpdaterPlugin.class);
        registerPlugin(SomniumBarsPlugin.class);
        registerPlugin(SomniumRemindersPlugin.class);
        registerPlugin(SomniumLockPlugin.class);
        // screenshots and the recents thumbnail stay blank unless allowed in Settings → Security (PLAN.md §4.3)
        SomniumLockPlugin.applySecure(this);
        super.onCreate(savedInstanceState);
    }
}
