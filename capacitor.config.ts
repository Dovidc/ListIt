import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.listit.app',
  appName: 'ListIt',
  webDir: 'public',
  bundledWebRuntime: false,
  ios: {
    contentInset: 'never',
    scrollEnabled: true,
    keyboardResize: 'native',
  },
};

export default config;
