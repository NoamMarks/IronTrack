# IronTrack — Android APK Release Spec (v1)

> **Status:** Draft for review
> **Owner:** Noam Marks
> **Target launch:** v1.1.0 (Android), iOS in a follow-up
> **Last updated:** 2026-05-03

This document specifies the work required to ship IronTrack as a distributable
Android APK / AAB on the Play Store, building on the existing Vite + React +
Supabase web app at `irontrack.vercel.app`.

---

## 1. Goal & non-goals

**Goal.** Ship a signed Android app (APK for sideload, AAB for Play Store)
that delivers the IronTrack web experience as a native-feeling mobile app:
fast cold-start, true full-screen, hardware-backed haptics + wake lock,
deep-link invite handling, and the same Supabase auth/data backend.

**Non-goals (v1).**
- iOS build — same plumbing, separate sprint.
- Offline-first sync — gym Wi-Fi is reliable enough; v1 adds cache resilience but
  not full conflict-resolved offline. Documented as v1.5.
- A fundamentally different UI for mobile — the responsive web layout we've
  already shipped is the mobile UI. The native shell is a thin wrapper.

---

## 2. Approach — Capacitor (recommended)

Three paths considered:

| Path | Effort | Native feel | Reuse | Verdict |
|---|---|---|---|---|
| **Capacitor 6** | 2-3 wks | High — real native APIs available | 100% web code | ✅ chosen |
| Trusted Web Activity (Bubblewrap) | 1 wk | Low — runs in Chrome Custom Tab | 100% | Backup if Capacitor blows up |
| React Native rewrite | 8-12 wks | Highest | ~30% logic | Rejected — cost/benefit poor |

**Why Capacitor over TWA.** TWA gives us a Play Store presence cheaply but
the experience is "your website in a Chrome shell" — no haptics on iOS later,
weak wake-lock guarantees, no Camera API, can't hide the OS browser chrome on
some devices. Capacitor wraps our existing build in a real Android WebView
with bridges to native APIs, and is the same stack we'd use for iOS.

**Why not RN.** Our value is in the Supabase data model and the program-editor
/ workout-logger UX — not the rendering surface. Rewriting in RN would burn
8-12 weeks to ship the same UX.

---

## 3. Architecture changes

### 3.1 Project layout

```
IronTrack/
├── src/                   # existing React app (unchanged)
├── api/                   # existing Vercel serverless funcs (unchanged)
├── android/               # NEW — Capacitor-generated Android project
├── capacitor.config.ts    # NEW — Capacitor config
├── public/                # existing — adds icon/splash/manifest
└── scripts/release/       # NEW — build, sign, upload helpers
```

The web build (`npm run build` → `dist/`) becomes the input to Capacitor's
`npx cap copy android` step. The same `dist/` is what Vercel serves at
`irontrack.vercel.app` — one source of truth, two distribution targets.

### 3.2 Runtime model

The Capacitor APK ships **the entire web bundle inside the APK**. On launch:

1. Android opens an embedded `WebView` pointed at `capacitor://localhost`.
2. Capacitor serves `dist/index.html` from the APK assets — no network
   needed for app code.
3. Supabase auth + REST calls go to `https://*.supabase.co` over HTTPS.
4. Our `/api/*` serverless calls go to `https://irontrack.vercel.app/api/*`
   (still hosted on Vercel — no need to bring those into the APK).

**Implication.** Every release ships a frozen web bundle. We do NOT support
hot-loading new web code from Vercel into the APK — that violates Play Store
policy (CWE-94 / dynamic code loading) and breaks crash-free rate guarantees.
A new web build → new APK build → Play Store update.

### 3.3 Code changes required in the web app

These all stay backward-compatible with the web build:

| Where | Change | Why |
|---|---|---|
| `src/lib/supabase.ts` | Pass `auth: { storage: capacitorStorage, ... }` when running inside Capacitor (detect via `Capacitor.isNativePlatform()`) | Use native SecureStorage instead of localStorage so the auth token survives WebView clears |
| `src/hooks/useWakeLock.ts` | Branch: native → `@capacitor-community/keep-awake`, web → existing `navigator.wakeLock` | The web Wake Lock API is unreliable when the OS dims; native keep-awake is rock-solid |
| `src/lib/haptics.ts` | Branch: native → `@capacitor/haptics`, web → existing `navigator.vibrate` | iOS haptics (later) need the native bridge; Android already works either way |
| `src/components/trainee/WorkoutGridLogger.tsx` (video upload) | Replace `<input type="file">` with `@capacitor/camera` `pickVideos` on native | The hidden file input opens the Android file picker; the Capacitor API gives a cleaner camera + gallery sheet |
| `src/components/auth/SignupPage.tsx` (deep links) | Already reads `?invite=` from `window.location.search` — no change needed | Deep-link invite URLs land on the same code path |
| `index.html` | Add `<meta name="theme-color" content="#09090b">`, viewport `viewport-fit=cover`, link `manifest.webmanifest` | Status bar tint + Android edge-to-edge + PWA manifest |

A small `src/lib/platform.ts` helper centralises the native/web branching:

```ts
import { Capacitor } from '@capacitor/core';
export const isNative = () => Capacitor.isNativePlatform();
export const platform = () => Capacitor.getPlatform(); // 'web' | 'ios' | 'android'
```

---

## 4. Auth & deep links

### 4.1 Magic-link invites — Android App Links

Coach generates `https://irontrack.vercel.app/signup?invite=CODE` and texts it
to a trainee. On a phone with the IronTrack APK installed, that URL must open
the app directly (not the browser). On a phone without it, it falls back to
the web app — same code, same UX.

**Mechanism.** Android App Links + Digital Asset Links file:

1. Add intent filter in `android/app/src/main/AndroidManifest.xml`:
   ```xml
   <intent-filter android:autoVerify="true">
     <action android:name="android.intent.action.VIEW" />
     <category android:name="android.intent.category.DEFAULT" />
     <category android:name="android.intent.category.BROWSABLE" />
     <data android:scheme="https"
           android:host="irontrack.vercel.app"
           android:pathPrefix="/signup" />
   </intent-filter>
   ```
2. Host `https://irontrack.vercel.app/.well-known/assetlinks.json` with the
   APK's signing-cert SHA-256:
   ```json
   [{
     "relation": ["delegate_permission/common.handle_all_urls"],
     "target": {
       "namespace": "android_app",
       "package_name": "com.irontrack.app",
       "sha256_cert_fingerprints": ["<KEYSTORE_SHA256>"]
     }
   }]
   ```
   Served from `public/.well-known/assetlinks.json` so Vercel deploys it.
3. Capacitor's `App.addListener('appUrlOpen', ...)` fires when the app opens
   from a deep link. Push the URL into `window.history` so React reads
   `window.location.search` like normal.

### 4.2 Supabase session persistence

Web uses `localStorage`. Inside the Capacitor WebView, localStorage works
but is wiped if the user clears app data. Move the Supabase auth storage
adapter to **Capacitor Preferences** (encrypted at rest on Android via
EncryptedSharedPreferences):

```ts
// src/lib/supabaseStorage.ts
import { Preferences } from '@capacitor/preferences';
import type { GoTrueClientOptions } from '@supabase/supabase-js';

export const capacitorStorage: NonNullable<GoTrueClientOptions['storage']> = {
  getItem:    async (k) => (await Preferences.get({ key: k })).value,
  setItem:    async (k, v) => { await Preferences.set({ key: k, value: v }); },
  removeItem: async (k) => { await Preferences.remove({ key: k }); },
};
```

Wired in `supabase.ts` only when `isNative()` is true — web continues using
the default `localStorage` adapter so vitest / Playwright keep working.

### 4.3 OAuth (future-proofing)

We're email/password + invite-code today. If we add Google / Apple sign-in
later, the redirect URI must be registered as a custom scheme:
`com.irontrack.app://oauth/callback`. Capacitor's `@capacitor/browser` plus
Supabase's `flowType: 'pkce'` handle this — out of scope for v1.

---

## 5. Native APIs we'll use

| Capacitor plugin | Used for | Replaces |
|---|---|---|
| `@capacitor/preferences` | Auth session storage | `localStorage` |
| `@capacitor-community/keep-awake` | Gym Mode wake lock | `navigator.wakeLock` |
| `@capacitor/haptics` | Set-done tick, finish-workout success | `navigator.vibrate` |
| `@capacitor/status-bar` | Match status bar to dark/light theme | n/a |
| `@capacitor/splash-screen` | Branded launch screen | n/a |
| `@capacitor/app` | Deep-link handling, back-button intercept | n/a |
| `@capacitor/camera` (optional, v1.5) | Video PR uploads | `<input type="file" accept="video/*">` |
| `@capacitor/network` (optional) | "You're offline" banner | n/a |
| `@capacitor/push-notifications` (v1.5) | Workout reminders | n/a |

All of these are MIT-licensed, actively maintained, and have ≤200KB of
native code each — total APK weight from plugins is <2MB.

---

## 6. App identity & assets

### 6.1 Identifiers

| Field | Value |
|---|---|
| **Package name** | `com.irontrack.app` |
| **App name** | IronTrack |
| **Application ID** | `com.irontrack.app` |
| **Display version** | `1.0.0` (from `package.json`) |
| **Version code** | Monotonic int, derived from `1_000_000 + buildNumber` so we never collide |
| **Min SDK** | 24 (Android 7.0) — covers >97% of active devices |
| **Target SDK** | 34 (Android 14) — required by Play Store after 2024-11 |
| **Permissions** | INTERNET, WAKE_LOCK, VIBRATE, READ_MEDIA_VIDEO (for v1.5 camera) |

### 6.2 Assets to produce

- **App icon** — 512×512 base PNG, generated into all required densities
  (`mipmap-mdpi` through `mipmap-xxxhdpi`) plus adaptive-icon foreground +
  background. Use Android Studio's Image Asset Studio or `cordova-res`.
- **Splash screen** — 2732×2732 base, generated to all device sizes.
  Background = `#09090b` (our `--color-background`), foreground = the
  IronTrack dumbbell logo.
- **Feature graphic for Play Store** — 1024×500.
- **Screenshots** — minimum 2, recommended 8: phone (16:9 portrait) showing
  Login → Resume hero → Workout grid mid-set → Finish CTA → Analytics chart →
  Coach admin panel → Plate calculator → Dark/light themes side-by-side.
- **Listing copy** — short description (80 chars), full description (4000),
  privacy policy URL.

### 6.3 Privacy policy

Required by Play Store. Document covers:
- What we collect: email, name, workout data (load, reps, RPE, video).
- Where it lives: Supabase (Frankfurt or US-East depending on project region).
- Who we share with: nobody — the trainee's coach has tenant-scoped access via
  RLS, that's the only sharing.
- Right to delete: covered by Supabase project tooling + the existing
  `cleanupUser` admin path.

Hosted at `https://irontrack.vercel.app/privacy` — needs to be added as a
new static page in the SPA.

---

## 7. Build & release pipeline

### 7.1 Local build

```
npm run build                  # vite build → dist/
npx cap sync android           # copies dist/ into android/app/src/main/assets/public
cd android
./gradlew assembleRelease      # → app-release-unsigned.apk
./gradlew bundleRelease        # → app-release.aab (Play Store)
```

### 7.2 Signing

- **Upload key.** Generated once with `keytool -genkey ...`, stored in
  `android/upload-keystore.jks`. **NEVER committed.** Stored encrypted in
  GitHub Secrets as `ANDROID_KEYSTORE_BASE64` + `ANDROID_KEYSTORE_PASSWORD`.
- **Signing config** in `android/app/build.gradle`:
  ```groovy
  signingConfigs {
    release {
      storeFile     file(System.getenv("ANDROID_KEYSTORE_PATH"))
      storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
      keyAlias      System.getenv("ANDROID_KEY_ALIAS")
      keyPassword   System.getenv("ANDROID_KEY_PASSWORD")
    }
  }
  ```
- **Play App Signing** enabled — Google holds the actual signing key, our
  upload key is just for upload auth. Loss of upload key is recoverable;
  loss of Play App Signing key is not.

### 7.3 CI/CD

GitHub Actions workflow `.github/workflows/android-release.yml`:

1. Trigger: `release/*` tag push
2. Steps:
   - Checkout, setup-node@20, setup-java@21
   - `npm ci && npm test && npx playwright test` (gate on green)
   - `npm run build`
   - `npx cap sync android`
   - Decode keystore from secret → temp file
   - `./gradlew bundleRelease`
   - Upload AAB as workflow artifact
   - (Optional) `r0adkll/upload-google-play@v1` → internal track on Play
     Console for QA pre-release
3. Cache: `~/.gradle`, `~/.android/build-cache`, `node_modules` — knocks
   build time from 8-10min cold to <3min warm.

### 7.4 Version bumping

The existing `prebuild` script auto-bumps `package.json` patch on every
build. For Android, the AAB also needs `versionCode` bumped. Add a
post-prebuild step in `scripts/release/bump-version-code.mjs`:

```js
// reads package.json version, computes 1_000_000*major + 1_000*minor + patch
// writes android/app/build.gradle versionCode + versionName
```

So `1.2.3` → `versionCode 1_002_003`. Monotonic, collision-free, predictable.

---

## 8. Testing strategy

| Layer | Tool | What it covers |
|---|---|---|
| **Unit** (existing) | vitest | Business logic, analytics — runs unchanged |
| **Web E2E** (existing) | Playwright | Full browser flow on `irontrack.vercel.app` — runs unchanged |
| **APK smoke** (new) | Android Studio emulator + manual checklist | Cold start, deep link, auth persistence, wake lock, camera, back-button |
| **APK E2E** (v1.5, optional) | Appium 2 + WebdriverIO | Same Playwright tests re-targeted at the WebView |
| **Beta** | Play Console internal track | 5-10 real coaches/trainees on real Android devices for 1 week before public |

The smoke checklist is the gate for v1. Appium is nice-to-have once the app
is stable.

### 8.1 Manual smoke checklist (gates each release)

- [ ] Cold install from APK, app opens to login in <2s on a Pixel 5
- [ ] Login persists across full app kill + relaunch
- [ ] Magic-link invite (`https://irontrack.vercel.app/signup?invite=...`)
      tapped from SMS opens the app, lands on signup, code prefilled
- [ ] Workout logger: typing weight pops the iOS-style number pad (Android
      `numberDecimal` IME)
- [ ] Wake lock prevents screen dimming while logger is open
- [ ] Per-set Done toggle vibrates briefly (haptic)
- [ ] Finish Workout returns to dashboard with "logged ✓" badge
- [ ] Back-button on dashboard does NOT log out (regression from this sprint)
- [ ] Light/dark theme toggle persists across relaunch
- [ ] Dark theme: status bar matches; Light theme: status bar matches
- [ ] No layout overflow at 360×640 (smallest Android phone we'll support)
- [ ] No layout overflow at 412×892 (Pixel 7)
- [ ] Plate calculator opens, applies weight back into the active set cell
- [ ] Sign-out via X icon in nav cleanly returns to login

---

## 9. Rollout plan

| Week | Milestone |
|---|---|
| **W1** | Capacitor scaffold, web bundle launches in Android emulator, identifiers + assets locked in |
| **W2** | Native API replacements (auth storage, wake lock, haptics), deep-link App Links wired, status bar + splash polished |
| **W3** | First signed AAB uploaded to Play Console internal track. Privacy policy + listing copy + screenshots done. Smoke checklist green on Pixel 5 + Pixel 7 + a Samsung A-series. |
| **W4** | Closed beta — 5-10 real users for 1 week. Bug-fix-only, no feature adds. |
| **W5** | Public production release on Play Store. Web URL banner: "Get the app". |

---

## 10. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Supabase WebView CORS quirks (apikey header rejected by some Android WebViews) | Medium | High — auth would break | Test on emulator + 3 real devices in W1; if seen, set `WebView.setAllowUniversalAccessFromFileURLs(true)` and add explicit `Origin` rewriting |
| Play Store rejects target SDK as out-of-date | Low | Medium | We're on 34 which is current as of 2026-05; track Google's annual SDK requirement bumps |
| App Links don't auto-verify (digital asset links file misconfigured) | Medium | Medium — invite links open in browser instead of app | Verify with `adb shell pm verify-app-links --re-verify com.irontrack.app` after each Vercel deploy |
| Vercel `/api/*` calls blocked by Capacitor's allowlist | Low | High — coach creation breaks | Add `irontrack.vercel.app` to `server.allowNavigation` in `capacitor.config.ts` |
| Supabase auth token wiped when user clears app data | Low | Low | This is correct behavior — user re-logs in. SecureStorage migration is a defense-in-depth, not a guarantee |
| Wake lock plugin doesn't release after Finish Workout | Low | Medium — drains battery | Explicit `KeepAwake.allowSleep()` in the cleanup useEffect; smoke-test by leaving app and checking battery cooldown |
| iOS later requires more changes than expected | High | Low | Out of scope for v1; document iOS-specific TODO list as we discover them |

---

## 11. Effort estimate

| Workstream | Days | Notes |
|---|---|---|
| Capacitor scaffold + web bundle in WebView | 1.5 | `npx cap init`, `cap add android`, fix the inevitable Gradle complaints |
| Auth storage + wake lock + haptics native bridges | 2 | Three plugins, each a single-file integration |
| Deep-link App Links + assetlinks.json | 1 | Plus 1d to wait for Google's link-verification cron |
| Status bar, splash screen, app icon | 1 | Mostly asset prep |
| Privacy policy page + listing copy | 0.5 | One static React route + content writing |
| Build pipeline (local + GitHub Actions) | 1.5 | Keystore handling is the time sink |
| Play Console setup + first internal upload | 1 | Account + payment + listing fields |
| Smoke checklist on 3 devices | 1 | Real-device cycle is slow |
| Beta bug fixes (reserved) | 3 | History says we'll burn at least this much |
| **Total** | **~12 working days (≈ 2.5 weeks)** | One engineer, no part-time interruptions |

---

## 12. Open questions (need decisions before W1)

1. **Domain.** Stay on `irontrack.vercel.app` or buy `irontrack.app`? App Links
   need the domain locked in — moving later means re-verifying.
2. **Resend email From: domain.** Currently in test mode. Production app
   needs a verified sender domain; ties into the domain decision above.
3. **Play Console account ownership.** Personal Google account vs a company
   workspace account. Affects payout, support contact, transferability.
4. **Crash reporting.** Sentry? Firebase Crashlytics? Or accept that v1
   ships with no remote crash visibility and rely on user reports?
5. **Analytics consent.** GDPR / Play Store now require an explicit consent
   screen if we add any analytics SDK. v1 has no analytics — ship without.

---

## 13. Out of scope (deferred to v1.5+)

- iOS build (same plumbing, separate sprint)
- True offline mode with conflict resolution
- Push notifications for workout reminders
- In-app camera capture for video form-checks
- Apple/Google sign-in
- Tablet-optimised layout
- Wear OS companion (for live HR + RPE during sets)
- App Store + Google Play in-app purchases (subscription tier)

---

## Appendix A — `capacitor.config.ts` starting point

```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.irontrack.app',
  appName: 'IronTrack',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    // Vercel-hosted /api/* endpoints + Supabase REST
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
```

## Appendix B — packages added

```
npm i \
  @capacitor/core@^6 \
  @capacitor/cli@^6 \
  @capacitor/android@^6 \
  @capacitor/preferences \
  @capacitor/status-bar \
  @capacitor/splash-screen \
  @capacitor/app \
  @capacitor/haptics \
  @capacitor-community/keep-awake
# v1.5 additions:
# @capacitor/camera @capacitor/push-notifications @capacitor/network
```

Approx +1.4 MB to `node_modules`, ~600 KB added to the final APK across all
plugin native code.

---

## Sign-off

- [ ] Engineering — owner of build pipeline + native bridges
- [ ] Design — owner of icon, splash, screenshots, listing copy
- [ ] Product — owner of privacy policy, Play Console listing
- [ ] Owner / business — owner of domain decision + Play account ownership
