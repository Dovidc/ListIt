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
  },
  ios: {
    contentInset: 'never',
    scrollEnabled: true,
    keyboardResize: 'native',
  },
};

export default config;
