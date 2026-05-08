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
  ios: {
    // Kill the rubber-band bounce at the WebView edges. With a brutalist
    // grid-based UI the elastic over-scroll reads as a layout glitch, not
    // as the platform-native gesture it's meant to be.
    scrollEnabled: false,
    // Match the brutalist dark surface so there is no white flash between
    // the launch image and the React tree painting. The launch StatusBar
    // style stays 'DARK' (set under plugins.StatusBar) which on iOS means
    // light glyphs over this dark backdrop.
    backgroundColor: '#09090b',
  },
  plugins: {
    SplashScreen: {
      // launchAutoHide:false keeps the splash up until App.tsx calls
      // SplashScreen.hide() once auth + program data are both hydrated.
      // launchShowDuration is ignored when autoHide is disabled; we leave
      // it at a sane upper-bound in case the React effect never fires
      // (e.g. a fatal hydration error) so the user isn't trapped on splash.
      launchShowDuration: 5000,
      launchAutoHide: false,
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
