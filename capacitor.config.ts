import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.irontrack.app',
  appName: 'IronTrack',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    allowNavigation: [
      'irontrack.vercel.app',
      '*.supabase.co',
      'fonts.googleapis.com',
      'fonts.gstatic.com',
    ],
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      backgroundColor: '#09090b',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#09090b',
    },
    KeepAwake: {},
  },
};

export default config;
