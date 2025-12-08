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
    contentInset: 'always',
    scrollEnabled: true,
    keyboardResize: 'body',
    backgroundColor: '#ffffff',
    allowsLinkPreview: false,
  },
};

export default config;
