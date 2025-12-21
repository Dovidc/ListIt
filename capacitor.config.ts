import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.listit.app',
  appName: 'Trovelr',
  webDir: 'public',
  bundledWebRuntime: false,
  server: {
    // Use app name instead of "localhost" in iOS permission dialogs
    hostname: 'Trovelr',
    androidScheme: 'https',
    iosScheme: 'https',
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
  },
  ios: {
    contentInset: 'never',
    scrollEnabled: true,
    keyboardResize: 'native',
  },
};

export default config;
