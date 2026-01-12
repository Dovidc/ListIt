import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.listit.app',
  appName: 'Trovelr',
  webDir: 'public',
  bundledWebRuntime: false,
  server: {
    androidScheme: 'https',
  },
  plugins: {
    CapacitorHttp: {
      // Required for auth cookies to work on iOS native
      enabled: true,
    },
    CapacitorCookies: {
      // Patch document.cookie to use native cookies
      enabled: true,
    },
    Keyboard: {
      // Hide the accessory bar (Previous/Next/Done buttons) above the keyboard
      hideAccessoryBar: true,
      // Resize mode - 'native' lets iOS handle it natively
      resize: 'native',
    },
  },
  ios: {
    contentInset: 'never',
    scrollEnabled: true,
    keyboardResize: 'native',
  },
  android: {
    // Resize the web view when keyboard appears so content isn't hidden
    keyboardResize: 'native',
  },
};

export default config;
