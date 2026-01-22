package com.trovelr.marketplace;

import android.os.Bundle;
import android.view.View;
import android.view.Window;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
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

        // Apply window insets to webview - handle system bars properly
        View rootView = window.getDecorView().getRootView();
        ViewCompat.setOnApplyWindowInsetsListener(rootView, (v, windowInsets) -> {
            Insets insets = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars());

            // Inject CSS custom properties with actual inset values
            String js = String.format(
                "javascript:(function(){" +
                "document.documentElement.style.setProperty('--safe-area-inset-top','%dpx');" +
                "document.documentElement.style.setProperty('--safe-area-inset-bottom','%dpx');" +
                "document.documentElement.style.setProperty('--safe-area-inset-left','%dpx');" +
                "document.documentElement.style.setProperty('--safe-area-inset-right','%dpx');" +
                "})()",
                insets.top, insets.bottom, insets.left, insets.right
            );

            // Execute after bridge is loaded
            getBridge().getWebView().post(() -> {
                getBridge().getWebView().evaluateJavascript(js, null);
            });

            return WindowInsetsCompat.CONSUMED;
        });
    }
}
