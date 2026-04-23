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

        // Get device density to convert physical px to CSS px (dp)
        float density = getResources().getDisplayMetrics().density;

        // Listen for ALL inset changes (system bars + keyboard)
        View rootView = window.getDecorView().getRootView();
        ViewCompat.setOnApplyWindowInsetsListener(rootView, (v, windowInsets) -> {
            Insets systemBars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars());
            Insets ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime());
            boolean imeVisible = windowInsets.isVisible(WindowInsetsCompat.Type.ime());

            // Convert from physical pixels to dp (CSS pixels)
            int top = Math.round(systemBars.top / density);
            int bottom = Math.round(systemBars.bottom / density);
            int left = Math.round(systemBars.left / density);
            int right = Math.round(systemBars.right / density);
            int keyboardHeight = Math.round(ime.bottom / density);

            // Build JS to inject CSS custom properties
            String js = String.format(
                "(function(){" +
                "var s=document.documentElement.style;" +
                "s.setProperty('--safe-area-inset-top','%dpx');" +
                "s.setProperty('--safe-area-inset-bottom','%dpx');" +
                "s.setProperty('--safe-area-inset-left','%dpx');" +
                "s.setProperty('--safe-area-inset-right','%dpx');" +
                "s.setProperty('--keyboard-height','%dpx');" +
                "document.body.classList.%s('keyboard-open');" +
                "})()",
                top, bottom, left, right, keyboardHeight,
                imeVisible ? "add" : "remove"
            );

            // Execute on WebView thread
            getBridge().getWebView().post(() -> {
                getBridge().getWebView().evaluateJavascript(js, null);
            });

            return WindowInsetsCompat.CONSUMED;
        });
    }
}
