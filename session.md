# IronTrack — Session Document

> **This is a living document.** Every developer working on this codebase reads it on day one and updates it with every meaningful change. The expectation is non-negotiable: if you ship a feature, fix a bug, change an architectural pattern, or add a dependency — you update this file in the same commit. A stale `session.md` is the team's failure, not just yours.

---

## Table of Contents

1. [Quick Orientation](#quick-orientation)
2. [Team Structure & Workflow](#team-structure--workflow)
3. [Tech Stack](#tech-stack)
4. [Architecture Overview](#architecture-overview)
5. [Project Structure](#project-structure)
6. [Data Model](#data-model)
7. [Authentication & Tenancy](#authentication--tenancy)
8. [Feature Inventory](#feature-inventory)
9. [Design System (FUI)](#design-system-fui)
10. [Critical Workflows](#critical-workflows)
11. [Environment & Deployment](#environment--deployment)
12. [Testing](#testing)
13. [Known Quirks & Gotchas](#known-quirks--gotchas)
14. [Update Protocol](#update-protocol)
15. [Current State](#current-state)

---

## Quick Orientation

**What it is:** A strength-training program management web app. Coaches design periodized training programs (weeks → days → exercises with custom data columns). Trainees log their workouts, view analytics (e1RM, volume, DOTS), and track progress over time. Wraps to Android and iOS via Capacitor.

**Status:** In production. Live at `https://irontrack.vercel.app`. Beta-ready as of 2026-05-09 pending final manual auth verification.

**Stack at a glance:** React 18 + TypeScript + Vite + Tailwind CSS + Supabase (auth + DB + RLS) + Capacitor (mobile) + Vercel (hosting + serverless functions).

**Aesthetic:** FUI (Futuristic UI) — sharp corners, electric cyan accents on dark navy backgrounds, monospace data display, corner-bracket card decorations, scanline overlay. Built to feel technical and high-performance.

---

## Team Structure & Workflow

- **Product/Project Manager (PM)** — Sets priorities, writes developer task prompts, reviews work after each sprint. **Does NOT touch code.**
- **Dev 1, Dev 2, Dev 3** — Implement features and fixes. Always run `npm run build` before marking work complete.
- **QA Automation Engineer** — Owns `src/__tests__/` and `e2e/`. Writes and fixes tests, runs E2E suites. Operates as a non-interactive coding agent — cannot manually click through a browser.

**Core sprint rules:**
1. **No two developers ever touch the same file in the same sprint.** The PM enforces this when assigning tasks.
2. Every developer prompt specifies exact files, exact changes, and ends with `npm run build`.
3. After a sprint, the PM reviews every file with a precise pass/fail audit before approving and assigning the next sprint.
4. QA reviews production with **read-only / mock-suite tests only** — no destructive flows against the live data plane.

---

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | React 18.2 | Mature, well-known |
| Language | TypeScript 5.2 (strict) | Type safety, refactor confidence |
| Build | Vite 5.2 | Fast HMR, fast prod builds |
| Styling | Tailwind 3.4 + CSS custom properties | Design tokens via `var(--color-*)` |
| Backend | Supabase | Postgres + Auth + RLS in one |
| Animation | Motion (Framer Motion fork) 11 | Page transitions, micro-interactions |
| Charts | Recharts 3.8 | Trainee analytics dashboards |
| Mobile | Capacitor 6 | Wraps SPA to Android/iOS |
| Email (auth) | Supabase Auth (Google SMTP) | OTP and password reset |
| Email (custom) | Resend (currently dead code) | Reserved for transactional emails |
| Push | `web-push` + Capacitor native | Coach-to-trainee notifications |
| Errors | Sentry | Production error monitoring |
| Tests | Vitest (unit) + Playwright (E2E) | Standard React testing stack |
| Hosting | Vercel | Static build + serverless `api/` functions |

---

## Architecture Overview

### Routing
**No React Router.** `App.tsx` holds a `view` state (string union: `'landing' | 'signup' | 'forgot' | 'coach' | 'trainee' | 'superadmin' | ...`). History managed via `history.pushState` snapshots for browser back/forward. Static routes (e.g. `/privacy`) are dispatched in `main.tsx` BEFORE React mounts.

**Why:** Original architectural decision — simpler than a router for a fixed set of views. Do not install React Router unless absolutely necessary.

### Three-Tier Tenancy
- **Superadmin** — `tenant_id IS NULL`. Sees everything across tenants.
- **Admin / Coach** — `tenant_id = own id`. Owns their tenant.
- **Trainee** — `tenant_id = coach's id`. Inherited at signup via invite code.

Supabase RLS enforces this server-side. Client-side filtering exists only for UI ergonomics, never as the security boundary.

### Two Mega-Hooks
- **`useAuth`** — session, profile, role-based view routing, impersonation. ~330 lines.
- **`useProgramData`** — nested `Client[]` tree CRUD with debounced saves. ~830 lines. The most-touched file in the codebase.

### Column Sync
Programs have dynamic columns (`ProgramColumn[]`). When a coach adds an exercise to a day in Week 1, it propagates to the same `dayNumber` in every other week. Sync is by **`dayNumber + array index`**, NOT by ID rewrite.

### Debounced Autosave
- Program edits debounced 500ms before hitting Supabase.
- Workout session edits debounced 800ms.
- Refs (`exercisesRef`, `dayRef`) used inside autosave callbacks to avoid stale closures.

### State Management
- React `useState` and `useReducer` only. No Redux, no Zustand, no Jotai.
- Cross-component state flows via prop drilling from `App.tsx`. The trade-off is intentional — keeps the surface area small.

---

## Project Structure

```
IronTrack/
├── api/                          # Vercel serverless functions
│   ├── signup-user.ts            # Invite code → OTP → profile creation
│   ├── admin-create-user.ts      # Superadmin creates a coach
│   └── send-notification.ts      # Web push delivery
├── android/                      # Capacitor Android shell
├── ios/                          # Capacitor iOS shell
├── e2e/                          # Playwright specs (~27 files)
├── public/                       # Static assets + push-handler.js (SW)
├── scripts/                      # Build/release scripts
├── supabase/
│   └── migrations/               # All schema changes go here
├── src/
│   ├── components/
│   │   ├── ui/                   # FUI primitives: Button, TechnicalCard, Modal, Toast, RPEBadge
│   │   ├── admin/                # Coach + Superadmin views
│   │   ├── trainee/              # Trainee dashboard, workout logger, analytics
│   │   ├── auth/                 # Login, signup, forgot password
│   │   ├── calculators/          # Standalone tools (RPE, points, plates)
│   │   ├── AccountSettings.tsx   # Name + password modal
│   │   ├── ErrorBoundary.tsx     # Global FUI fallback
│   │   └── static/PrivacyPolicy.tsx
│   ├── hooks/
│   │   ├── useAuth.ts            # Session + role routing
│   │   ├── useProgramData.ts     # The big one. 800+ lines.
│   │   ├── useExerciseLibrary.ts # Global + per-coach exercise catalogue
│   │   ├── useTemplates.ts       # Program template CRUD
│   │   ├── useRecentActivity.ts  # Coach activity feed
│   │   ├── useDeepLinks.ts       # Mobile invite link handling
│   │   └── useWakeLock.ts        # Keep device awake during workout
│   ├── lib/
│   │   ├── analytics.ts          # e1RM, volume, compliance, autoregulation, deload
│   │   ├── progressiveOverload.ts# Previous-week lookups
│   │   ├── plateCalculator.ts    # Barbell loading math
│   │   ├── pushSubscription.ts   # Subscribe + save to Supabase
│   │   ├── supabase.ts           # Client init
│   │   ├── platform.ts           # isNative() detection
│   │   ├── haptics.ts            # Capacitor haptic feedback
│   │   ├── numericInput.ts       # Sanitize + clamp numeric inputs
│   │   ├── validation.ts         # Email/password validation
│   │   ├── verification.ts       # OTP flow utilities
│   │   ├── inviteCodes.ts        # Generate + normalize invite codes
│   │   ├── voiceCommands.ts      # Rest timer voice input
│   │   ├── crypto.ts             # SHA-256 password hashing (legacy)
│   │   ├── email.ts              # Dead code — Resend templates not used
│   │   ├── formulas.ts           # DOTS, strength tiers
│   │   └── utils.ts              # cn() helper
│   ├── types.ts                  # All TypeScript interfaces
│   ├── App.tsx                   # The shell. 1500+ lines.
│   ├── main.tsx                  # Bootstrap, Sentry init, LazyMotion wrap
│   └── index.css                 # FUI design tokens + body styles
├── package.json
├── vite.config.ts                # PWA + manualChunks splitting
├── tailwind.config.js            # Token → utility mappings
└── playwright.config.ts          # E2E config (supports PLAYWRIGHT_BASE_URL for prod)
```

---

## Data Model

### Core Tables (Supabase Postgres)

- **`profiles`** — One row per user. `id` references `auth.users(id)`. Fields: `name`, `email`, `role`, `tenant_id`, `active_program_id`, `push_subscription` (jsonb).
- **`programs`** — Training blocks per client. Fields: `name`, JSONB `columns`, `status` (`active`/`archived`), `coach_notes`, `archived_at`.
- **`weeks`** — `program_id`, `week_number`. Unique on `(program_id, week_number)`.
- **`days`** — `week_id`, `day_number`, `name`, `logged_at`, `difficulty` (1–5), `reflection_note`, `reflection_at`, `coach_note`.
- **`exercises`** — `day_id`, `position`, `exercise_name`, `sets`, `reps`, `expected_rpe`, `weight_range`, `actual_load`, `actual_rpe`, `notes`, `video_url`, `values` jsonb (for custom columns).
- **`invite_codes`** — `code`, `tenant_id`, `coach_id`, `max_uses`, `use_count`.
- **`program_templates`** — Reusable program structures, scoped per coach.
- **`exercise_library`** — Global + coach-scoped exercise catalogue.
- **`exercise_goals`** — Trainee e1RM goals per exercise.
- **`body_weight_log`** — Daily trainee weight history.

### RLS Patterns
- Users read/write their own profile row.
- Coaches read all profiles where `tenant_id = own id`.
- Coaches read/write all programs/weeks/days/exercises belonging to their tenant.
- Superadmin sees everything.

### Type Mapping
TypeScript types in `src/types.ts` use **camelCase**. Database columns use **snake_case**. The `rowToProgram()` and `profileToClient()` mappers in `useProgramData.ts` translate between them.

**When adding a new column:** update the row interface AND the mapper — both directions.

---

## Authentication & Tenancy

### Coach Signup
- Self-signup → coach (`role = 'admin'`, `tenant_id = own id` via DB trigger).

### Trainee Signup
1. Coach generates an invite code (`createInviteCode` in `useProgramData`)
2. Coach shares the invite URL
3. Trainee opens URL, enters email
4. `supabase.auth.signInWithOtp()` sends a 6-digit code via Supabase Auth (Google SMTP)
5. Trainee verifies OTP, sets password
6. `api/signup-user.ts` validates the invite code server-side, creates the profile with `tenant_id = coach's id`, increments `invite_codes.use_count`

### Password Reset
- `supabase.auth.resetPasswordForEmail()` with `redirectTo = window.location.origin` (no path suffix — the SPA has no URL router)
- Supabase email contains `{{ .ConfirmationURL }}` link
- User clicks → arrives at app root with recovery token in URL hash
- `useAuth` detects `type=recovery` in hash → shows reset form

### Email Templates
- **Configured in Supabase Dashboard**, not in code.
- Custom Resend templates in `src/lib/email.ts` are dead code from an earlier design — they are NOT called in current flows.
- If email content is wrong, fix the Supabase dashboard → Authentication → Email Templates.

### Impersonation
Superadmin can impersonate a coach. Implemented as a client-side `authenticatedUser` swap with the original superadmin stored in `state.impersonating`. RLS still applies server-side (superadmin can read everything, so queries transparently work). Guards in `useAuth` prevent nested impersonation and gracefully handle stopping when not impersonating.

---

## Feature Inventory

### Coach Features
- Client list with compliance dots (green ≤3d, amber 4–7d, red 7+d since last logged session) and pulsing ring on active clients
- Add trainee via invite code generation (copyable URL)
- Program editor (weeks → days → exercises with custom columns)
- Drag-and-drop reordering of exercises and days (with keyboard + touch fallback; day reorders propagate `dayNumber` across all weeks)
- Batch exercise import (paste newline-separated names)
- Save/load/edit/delete program templates
- Program duplication (with actuals stripped)
- Program archive
- Coach feedback on completed sessions (visible to trainee in history)
- Program block notes (coach context visible to trainee on dashboard)
- Client notes (coach-private, localStorage per device)
- Real-time activity feed (Supabase realtime subscription)
- Cohort analytics across all trainees (aggregate compliance, sessions, PRs)
- Push notifications to trainees (`api/send-notification.ts`)
- Send-feedback compose UI per client in the sidebar

### Trainee Features
- Workout grid logger with per-set load/RPE/completion toggle
- Inline plate calculator
- Rest timer (FAB, voice commands, presets)
- Post-workout reflection (1–5 difficulty + free-text note)
- Workout history drill-down (Eye icon on logged days → FUI history modal)
- Analytics (e1RM, volume, DOTS — Recharts area charts with token-colored strokes)
- 1RM goal line on e1RM chart (per-exercise, persisted in `exercise_goals` table)
- Body weight log (improves DOTS accuracy over time)
- Deload warning badge (volume drop >20% week-over-week)
- Autoregulation banner (RPE-based load suggestions after ≥2 sessions)
- Progress report (compliance, PRs, summary — Modal-rendered)
- Account settings (name update + password change)

### Superadmin Features
- Platform stats (coaches, trainees, programs, sessions logged)
- Coach search and compliance overview
- Create new coach accounts
- Impersonate any coach (with amber banner during impersonation)

### Cross-Cutting
- FUI design system (sharp corners, cyan accents, monospace data)
- Offline detection banner (top of `AppShell` when `navigator.onLine === false`)
- Global error boundary with FUI-styled fallback + Sentry capture
- Network retry on initial data load (exponential backoff, 3 attempts)
- Command palette (Cmd+K / Ctrl+K) for global search across clients, exercises, and quick actions
- PWA install support
- Capacitor wrapping for Android/iOS (haptics, wake lock, keyboard handling)

---

## Design System (FUI)

All colors, radii, and glows are CSS custom properties in `src/index.css`. Tailwind maps them via `tailwind.config.js`. Changing a token cascades everywhere. **Component classes never use raw color hex codes — always tokens.**

### Tokens
- `--color-primary` = `#00D4FF` (electric cyan) — CTAs, active states, focus
- `--color-accent` = `#00FF88` (electric green) — success, completion, logged states
- `--color-danger` = `#FF3B5C` (hot red) — errors, destructive actions
- `--color-warning` = `#FFB300` (amber) — warnings, deload badges
- `--color-surface` = `#0A1628` (dark navy) — card backgrounds
- `--color-background` = `#020408` (near-black) — page background
- `--color-foreground` = `#E2F4FF` (cool white) — body text
- `--color-border` = `#1A3A5C` (dim cyan-blue)
- `--color-muted-foreground` = `#4A7A9B` (steel blue)
- `--radius-card`, `--radius-input` = `0px` (FUI uses sharp corners)
- `--glow-primary`, `--glow-accent`, `--glow-danger`, `--glow-warning` — `box-shadow` values

### Fonts
- `font-display` = Rajdhani (Google Fonts) — for headings, uppercase data
- `font-mono` = JetBrains Mono — for all numeric / technical data
- `font-sans` = Inter — body text (rarely used)

### Body
The body has a fixed cyan dot-grid background and a scanline overlay (`body::after`). Both are pure CSS — no JS animation, no performance cost.

### Component Rules
- **Cards** — Wrap in `<TechnicalCard>` for corner-bracket decoration. Optional `glow` prop applies a hover shadow.
- **Buttons** — Use `<Button variant="primary|ghost|danger" size="sm|md">`. Never use raw `bg-foreground text-background` patterns — those are FUI debt.
- **Inputs** — Use `<TechnicalInput>` for FUI bottom-border styling, or apply `bg-surface border-b border-primary/30 focus:border-primary` directly.
- **Modals** — Wrap in `<Modal>` — it ships with corner brackets and a title separator.
- **Headings** — `font-display font-bold uppercase tracking-[0.1em]` is the standard pattern.

### Animation Performance
- Animate only `transform` and `opacity`. Never `width`, `height`, `top`, `left`, `margin`, or layout properties.
- For dynamic widths (e.g., progress bars), use `scaleX` with `transformOrigin: 'left'`.
- All glow effects use CSS `box-shadow` tokens — do not animate them via JS.

---

## Critical Workflows

### Adding a Database Column
1. Create a new migration file in `supabase/migrations/` with date prefix (e.g., `2026-05-09_my_feature.sql`)
2. Use `if not exists` clauses for idempotency
3. Update the relevant TypeScript row interface in `useProgramData.ts` (e.g., `ProgramRow`, `DayRow`)
4. Update the row → object mapper (`rowToProgram`, `profileToClient`, etc.)
5. Update `src/types.ts` if it's a user-facing field
6. Apply the migration to staging/production Supabase manually OR via `supabase db push`
7. Update **Data Model** section in this file

### Adding a Vercel API Function
1. Create `api/your-function.ts` exporting a default handler
2. Validate Bearer token: `Authorization: Bearer <jwt>` → `supabase.auth.getUser(token)`
3. Enforce tenant isolation: caller's `tenant_id` must match the operation target (or caller must be superadmin)
4. Return structured error responses: `{ error: 'string' }` with appropriate status code
5. Use the service-role Supabase client (`SUPABASE_SERVICE_ROLE_KEY`) only AFTER auth + role checks pass
6. Update **Feature Inventory** and any relevant section here

### Working with the Design System
- Never use raw color hex codes in components. Always use token classes.
- Never use `rounded-*` classes on non-circular elements.
- Use `font-display` for headings, `font-mono` for data/labels.
- Always wrap cards in `TechnicalCard`.
- Always use the `Button` component for actions (where practical).

### Sprint Workflow
1. PM writes per-developer task prompts with explicit file ownership
2. Developers implement in parallel — no two on the same file
3. Each developer runs `npm run build` before signaling done
4. PM does precise pass/fail review across all changed files
5. QA writes/fixes tests in `src/__tests__/` and `e2e/` independently
6. Repeat

---

## Environment & Deployment

### Environment Variables (`.env.example`)

```
VITE_PUBLIC_URL=https://irontrack.vercel.app
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...      # Server-only — Vercel functions
RESEND_API_KEY=...                  # Reserved — currently unused in flows
VITE_VAPID_PUBLIC_KEY=...           # Push notifications (client)
VAPID_PRIVATE_KEY=...               # Push notifications (server-only)
VAPID_SUBJECT=mailto:admin@irontrack.app
VITE_SENTRY_DSN=...                 # Error monitoring (optional)
```

### Deploy Sequence
1. Run `npm run build` — must pass zero errors
2. Apply pending migrations against production Supabase (dashboard SQL editor or `supabase db push`)
3. Confirm all env vars are set in Vercel (Production scope), including any new ones
4. `git push origin main` — Vercel auto-deploys
5. QA runs the mock-suite E2E against the live URL
6. Product owner runs the manual checklist for auth and real-data flows
7. Deploy beta access once verified

### Mobile (Capacitor)
- `npm run build && npx cap sync android` — sync web bundle into native shell
- Open `android/` in Android Studio → build APK
- iOS: open `ios/` in Xcode (Mac required)
- The `prebuild` script in `package.json` auto-bumps `versionCode` on every build

---

## Testing

### Unit Tests (Vitest)
- Location: `src/__tests__/`
- Run: `npm test`
- 21+ files, 244+ tests as of 2026-05-09
- Coverage: analytics formulas, compliance computation, autoregulation logic, plate calculator, numeric input sanitization, voice command parsing, program duplication, etc.

### E2E Tests (Playwright)
- Location: `e2e/`
- Run locally: `npm run test:e2e` (spins up `vercel dev` automatically)
- Run against production: `PLAYWRIGHT_BASE_URL=https://irontrack.vercel.app npx playwright test <safe-specs>`

**Safety rule:** Specs using the `installMockSupabase` fixture are hermetic and safe against production. Specs that don't (auth/signup/security flows) MUST NOT be run against production — they create real users, send real emails, and hit Supabase rate limits.

**Safe specs for production runs:**
`program-editor`, `analytics-v2`, `coach-activity`, `coach-feedback`, `cohort-analytics`, `compliance-dashboard`, `program-duplication`, `workout-history`, `templates`, `exercise-library`, `console-audit`

### Playwright Config
- `playwright.config.ts` reads `PLAYWRIGHT_BASE_URL` to support production verification
- `webServer` is skipped when targeting an external URL — only spins up `vercel dev` locally

---

## Known Quirks & Gotchas

- **No URL router.** `view` state in `App.tsx` drives navigation. Adding new "pages" = add a view variant + render case. Do not install React Router unless absolutely required.
- **LazyMotion is NOT in strict mode.** Uses `domAnimation` features only. If you add a layout animation or `drag` to a `motion.div`, you'll need to switch to `m.div` everywhere or remove LazyMotion.
- **Column propagation is by `dayNumber + index`, not ID.** Reordering exercises is per-week-per-day. Adding/deleting exercises propagates across all weeks. Reordering days swaps `dayNumber` across all weeks atomically.
- **Coach notes are localStorage, not Supabase.** Per-device, per-coach. Intentional — they're a private scratchpad. Won't sync across devices.
- **Resend email templates in `src/lib/email.ts` are dead code.** All auth emails go through Supabase. To change email content, update Supabase email templates in the dashboard.
- **Push notifications need VAPID keys.** If `VITE_VAPID_PUBLIC_KEY` is missing, `subscribeToPush()` no-ops gracefully — no errors, just no subscriptions.
- **The `prebuild` hook auto-bumps version.** Don't be surprised when `package.json` version increments on every build.
- **Sentry only initializes if `VITE_SENTRY_DSN` is set.** Local dev has no Sentry by default.
- **`AUTH_SECRET`, `DATABASE_URL`, `AUTH_URL` in Vercel are unrelated** — leftovers from another project. Safe to remove if you're cleaning up.
- **Animations on `width` / `height` / `top` / `left` are forbidden.** They reflow and tank performance. Use `transform`/`opacity` only.
- **`exerciseId` in custom batch import is derived from name** (`name.toLowerCase().replace(/\s+/g, '_')`). Duplicate names collide. Consider this when implementing analytics across imported exercises.
- **The progress bar in `WorkoutGridLogger` uses `scaleX`, not `width`** — this was a deliberate fix from a previous performance audit.
- **Drag-and-drop uses @dnd-kit, NOT Framer Motion.** Do not animate dragged items with motion — dnd-kit's transform handler will conflict. Sortable rows/cards render through the `SortableShell` render-prop helper in `ProgramEditor.tsx`; the up/down chevrons stay alongside the grip handle as a keyboard fallback (don't remove them).
- **Cmd+K / Ctrl+K is reserved for the command palette.** If you add another keyboard shortcut, check `useCommandPalette.ts` first — it owns the global keydown listener.
- **Recharts `<ReferenceLine>` defaults to `ifOverflow="discard"`** — any reference line outside the data's Y-axis domain is silently hidden. If you add a goal/target line to a chart, set `ifOverflow="extendDomain"` so the axis expands to include it. We hit this with the 1RM goal feature: trainees setting aspirational goals saw no line until they'd already exceeded it.

---

## Update Protocol

**This document is part of every code change.** Update it in the same commit as:

- New features → add to **Feature Inventory**
- New database columns/tables → update **Data Model** + **Critical Workflows**
- New environment variables → update **Environment & Deployment**
- New architectural patterns → add to **Architecture Overview**
- New testing patterns or specs → update **Testing**
- Anything surprising or non-obvious → add to **Known Quirks & Gotchas**
- Tech stack changes → update **Tech Stack**
- Team structure changes → update **Team Structure & Workflow**

**What does NOT need an update:**
- Routine bug fixes (unless they reveal a quirk worth documenting)
- Style tweaks within existing components
- Test additions for already-documented features

**Pre-PR checklist:**
- [ ] Is the Feature Inventory still accurate?
- [ ] Did I add a new gotcha that would have saved me time yesterday?
- [ ] Are the environment variables up to date?
- [ ] Did I introduce a new pattern that belongs in Critical Workflows?
- [ ] Did I bump the **Current State** section if I shipped something visible?

---

## Current State

**As of 2026-05-09.**

**Live at:** `https://irontrack.vercel.app` — build v1.0.25.

**Production health:** Green. SPA mounts cleanly, no console errors, all API endpoints respond correctly with structured errors for malformed input, 32 of 39 mock-suite E2E tests pass against production.

**Pending before beta launch:**
- Manual auth/email/real-data checklist by product owner (auth happy path, password reset content, invite code redemption, etc.)
- Supabase email template updates (signup OTP must clearly display `{{ .Token }}`, reset password must include `{{ .ConfirmationURL }}`)
- 7 test selector fixes by QA (test code only — not production bugs):
  - Button text changes (`+ Add Week` → `+ Week`, `+ Add Day` → `+ Day`)
  - Category pill in `ExerciseCombobox` intercepts fast Playwright clicks
  - Numeric input strips negatives (intentional behavior change, test expectation outdated)
  - Templates delete flow uses custom modal, not `window.confirm`
  - `workout-history` heading selector ambiguity (matches both day card and modal heading)

**Recent sprints completed:**
- FUI design system overhaul (Epics 1–8): tokens, base components, landing hero, coach dashboard, workout logger, analytics dashboard, history modal, mobile/performance audit
- Foundation hardening: Sentry, error boundary, offline detection banner, retry logic on initial data load
- Coach features: compliance dashboard, cohort analytics, push notifications (full stack), client notes, block notes, coach session feedback, program duplication, template library maturity, exercise category filter, day reordering, batch exercise import
- Trainee features: workout history drill-down, autoregulation banner, deload detection, body weight log, progress report, 1RM goal lines on charts, account settings (name + password)
- Bug fixes: invite code use_count increment, password trimming consistency, tenant isolation fallback removed, archived program write protection, video blob URL revocation, timezone-correct analytics dates, impersonation hardening, `LazyMotion strict` removal (production blocker), final FUI cleanup across 4 components, `ForgotPasswordPage` `redirectTo` simplification

**Open backlog (not started):**
- Notification scheduling (currently only instant push)
- Week duplication within a program
- CSV/PDF export of progress data
- Mobile-specific testing of Capacitor builds
- Strength tier comparison to standards / peer benchmarks
- Cross-device sync of coach notes (currently localStorage only)
- Automated injury / pain tracking
- Coach video library management

---

**End of session.md.** Keep it true.
