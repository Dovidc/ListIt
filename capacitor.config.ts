import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.listit.app',
  appName: 'Trovelr',
  webDir: 'public',
  bundledWebRuntime: false,
  server: {
    // Custom hostname so iOS permission dialogs say "trovelr" instead of "localhost"
    hostname: 'trovelr',
    androidScheme: 'https',
    iosScheme: 'capacitor',
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
