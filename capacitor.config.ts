import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.listit.app',
  appName: 'ListIt',
  webDir: 'public',
  bundledWebRuntime: false,
  server: {
    url: 'https://trovelr.com',
  },
};

export default config;
