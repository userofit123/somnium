package org.somnium.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SomniumUpdaterPlugin.class);
        registerPlugin(SomniumBarsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
