package com.trovelr.marketplace;

import android.os.Bundle;
import android.view.View;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Enable edge-to-edge: let content go behind system bars
        Window window = getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, false);

        // Make navigation bar transparent
        window.setNavigationBarColor(android.graphics.Color.TRANSPARENT);

        // Set light navigation bar icons (dark icons on light background)
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        if (controller != null) {
            controller.setAppearanceLightNavigationBars(true);
        }
    }
}
