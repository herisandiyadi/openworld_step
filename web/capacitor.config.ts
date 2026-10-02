import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.openworld.city',
  appName: 'Openworld City',
  webDir: 'dist',
  android: {
    backgroundColor: '#bcd3e6',
    // The AI endpoint may be plain HTTP on the LAN; the API key is still only sent to the URL the player enters.
    allowMixedContent: true,
  },
};

export default config;