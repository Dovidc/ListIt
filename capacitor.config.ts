import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.listit.app',
  appName: 'ListIt',
  webDir: 'public',
  bundledWebRuntime: false,
  server: {
    url: 'https://trovelr.com',
  },
  ios: {
    contentInset: 'automatic',
    scrollEnabled: true,
    keyboardResize: 'none',
    backgroundColor: '#0f172a',
  },
};

export default config;
