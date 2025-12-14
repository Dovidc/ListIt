import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.listit.app',
  appName: 'ListIt',
  webDir: 'public',
  bundledWebRuntime: false,
  plugins: {
    CapacitorHttp: {
      // Patch fetch() to use native HTTP - bypasses CORS/cookie issues
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
