import React, { useState, useEffect, useRef } from 'react';
import { differenceInDays, formatDistanceToNow } from 'date-fns';
import {
  Dumbbell,
  ShieldCheck,
  Sun,
  Moon,
  UserPlus,
  X,
  ChevronRight,
  Users,
  ArrowLeft,
  LogIn,
  BarChart3,
  ClipboardList,
  Layers,
  TrendingUp,
  Timer,
  Calculator,
  Activity,
  Gauge,
  Trophy,
  Wifi,
  WifiOff,
} from 'lucide-react';

// `Wifi` is imported alongside WifiOff so a future "back online" momentary
// indicator can use it without re-touching the import block. void keeps
// noUnusedLocals quiet without dropping the symbol.
void Wifi;
import { motion, AnimatePresence } from 'motion/react';

import { KeepAwake } from '@capacitor-community/keep-awake';

import { useAuth } from './hooks/useAuth';
import { useProgramData } from './hooks/useProgramData';
import { useDeepLinks } from './hooks/useDeepLinks';
import { isNative } from './lib/platform';
import { supabase } from './lib/supabase';
import { TechnicalCard, TechnicalInput, Modal, Toast, Button } from './components/ui';
import { AccountSettings } from './components/AccountSettings';
import { CommandPalette } from './components/CommandPalette';
import { useCommandPalette } from './hooks/useCommandPalette';
import { cn } from './lib/utils';
import { AdminView } from './components/admin/AdminView';
import { SuperadminView } from './components/admin/SuperadminView';
import { ClientDashboard } from './components/trainee/ClientDashboard';
import { WorkoutGridLogger } from './components/trainee/WorkoutGridLogger';
import { RestTimer } from './components/trainee/RestTimer';
import { PlateCalculator } from './components/trainee/PlateCalculator';
import { PostWorkoutReflectionModal } from './components/trainee/PostWorkoutReflectionModal';
import { RPECalculator } from './components/calculators/RPECalculator';
import { PointsCalculator } from './components/calculators/PointsCalculator';
import { SignupPage } from './components/auth/SignupPage';
import { ForgotPasswordPage } from './components/auth/ForgotPasswordPage';
import { checkPasswordStrength } from './lib/crypto';
import { isValidEmail, INVALID_EMAIL_MESSAGE } from './lib/validation';
import { subscribeToPush } from './lib/pushSubscription';
import type { Client, WorkoutWeek, WorkoutDay, UserRole } from './types';

// ─── Coach: Client list view ─────────────────────────────────────────────────

/** Compute the most recent loggedAt across all non-archived programs. */
function getLastLoggedMs(client: Client): number | null {
  let best: number | null = null;
  for (const program of client.programs) {
    if (program.status === 'archived') continue;
    for (const week of program.weeks) {
      for (const day of week.days) {
        if (!day.loggedAt) continue;
        const ms = new Date(day.loggedAt).getTime();
        if (best === null || ms > best) best = ms;
      }
    }
  }
  return best;
}

function getComplianceInfo(client: Client): { dotClass: string; label: string; status: 'green' | 'amber' | 'red' } {
  const lastMs = getLastLoggedMs(client);
  if (lastMs === null) return { dotClass: 'bg-danger', label: 'No sessions', status: 'red' };
  const lastDate = new Date(lastMs);
  const days = differenceInDays(new Date(), lastDate);
  const label = days === 0 ? 'Today' : formatDistanceToNow(lastDate, { addSuffix: true });
  if (days <= 3) return { dotClass: 'bg-accent', label, status: 'green' };
  if (days <= 7) return { dotClass: 'bg-warning', label, status: 'amber' };
  return { dotClass: 'bg-danger', label, status: 'red' };
}

function ClientListView({
  clients,
  onSelectClient,
  onAddClient,
}: {
  clients: Client[];
  onSelectClient: (c: Client) => void;
  onAddClient: () => void;
}) {
  const trainees = clients.filter((c) => c.role === 'trainee');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  return (
    <div className="space-y-8">
      <header className="flex justify-between items-end">
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
          <h1 className="text-4xl font-display font-bold uppercase tracking-[0.1em] text-foreground">
            Clients
          </h1>
          <p className="text-muted-foreground font-mono text-xs mt-1 uppercase tracking-[0.2em]">
            Active Training Management
          </p>
        </motion.div>
        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
          <Button variant="primary" onClick={onAddClient}>+ New Client</Button>
        </motion.div>
      </header>

      <motion.div
        initial="hidden"
        animate="visible"
        variants={{ visible: { transition: { staggerChildren: 0.07 } } }}
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
      >
        {trainees.map((client) => {
          const compliance = getComplianceInfo(client);
          return (
            <motion.div
              key={client.id}
              variants={{ hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4 } } }}
            >
              <div
                onMouseEnter={() => setHoveredId(client.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                <TechnicalCard glow={hoveredId === client.id ? 'primary' : 'none'} className="transition-all">
                  <div onClick={() => onSelectClient(client)} className="p-8 cursor-pointer">
                    <div className="flex justify-between items-start mb-6">
                      <div className="w-12 h-12 bg-muted flex items-center justify-center">
                        <Users className="w-6 h-6" />
                      </div>
                      <div className="flex items-center gap-2">
                        {/* Compliance dot with ping ring for active clients */}
                        <div className="relative flex items-center justify-center w-5 h-5">
                          {compliance.status === 'green' && (
                            <span className="absolute inline-flex w-full h-full rounded-full bg-accent/40 animate-ping" />
                          )}
                          <span className={cn('w-2.5 h-2.5 rounded-full relative', compliance.dotClass)} />
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest">Last Trained</p>
                          <p className="text-[10px] text-foreground font-mono uppercase font-bold">{compliance.label}</p>
                        </div>
                      </div>
                    </div>
                    <h3 className="text-xl font-display font-semibold text-foreground mb-1 tracking-wide uppercase">{client.name}</h3>
                    <p className="text-xs text-muted-foreground font-mono mb-6">{client.email}</p>
                    <div className="border-t border-border pt-6 flex justify-between items-center">
                      <div>
                        <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest">Program</p>
                        <p className="text-sm text-primary/80 font-mono font-medium">
                          {client.programs[0]?.name ?? 'No Program'}
                        </p>
                      </div>
                      <div className="w-8 h-8 border border-primary/30 text-primary/50 flex items-center justify-center hover:border-primary hover:text-primary transition-all">
                        <ChevronRight className="w-4 h-4" />
                      </div>
                    </div>
                  </div>
                </TechnicalCard>
              </div>
            </motion.div>
          );
        })}
      </motion.div>
    </div>
  );
}

// ─── Landing / Login ─────────────────────────────────────────────────────────

const COACH_FEATURES = [
  {
    icon: ClipboardList,
    label: 'Program Editor',
    body: 'Construct periodized blocks with weeks, days, and exercises. Add custom plan/actual columns that propagate across the entire mesocycle.',
  },
  {
    icon: Users,
    label: 'Client Management',
    body: 'Onboard trainees through invite codes. Multi-tenant isolation enforced server-side — your roster, your data, no leakage.',
  },
  {
    icon: BarChart3,
    label: 'Performance Analytics',
    body: 'Track 1RM trajectories, weekly volume, and progressive overload. See who pushed and who plateaued at a glance.',
  },
  {
    icon: Layers,
    label: 'Custom Columns',
    body: 'Define your own metrics — tempo, RIR, bar position. Plan/actual pairing is built-in. No rigid templates to fight against.',
  },
] as const;

const TRAINEE_FEATURES = [
  {
    icon: Dumbbell,
    label: 'Workout Logger',
    body: 'Grid interface. Log load and RPE in seconds. Prescribed targets sit alongside what you actually hit.',
  },
  {
    icon: TrendingUp,
    label: 'Progress Tracking',
    body: 'Compare every set against last week, last month, or program start. No more guessing if you are trending up.',
  },
  {
    icon: Timer,
    label: 'Rest Timer',
    body: 'Auto-starts between sets, audible cues, persistent across screens. The timer does not care if you switch tabs.',
  },
  {
    icon: Calculator,
    label: 'Plate Calculator',
    body: 'Tap a target weight, get exact plate breakdowns for standard bars. Saves the math when your hands are chalked.',
  },
] as const;

const SAMPLE_LOG_ROWS = [
  { name: 'Back Squat',     sets: '4×5',    plan: '160 @7',  actual: '162 @8' },
  { name: 'Romanian DL',    sets: '3×8',    plan: '120 @8',  actual: '122 @8' },
  { name: 'Walking Lunge',  sets: '3×10',   plan: '24 @7',   actual: '24 @7'  },
  { name: 'Hanging L-sit',  sets: '4×0:20', plan: 'BW @8',   actual: 'BW @9'  },
] as const;

function LandingPage({
  onLogin,
  onSignup,
  onForgot,
  loginError,
  isBootstrapping,
  theme,
  onToggleTheme,
}: {
  onLogin: (email: string, password: string) => void;
  onSignup: () => void;
  onForgot: () => void;
  loginError: string;
  isBootstrapping: boolean;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formatError, setFormatError] = useState('');
  const [showLogin, setShowLogin] = useState(false);

  const openLogin = () => setShowLogin(true);
  const closeLogin = () => {
    setShowLogin(false);
    setFormatError('');
  };

  const handleSubmit = () => {
    if (!isValidEmail(email)) {
      setFormatError(INVALID_EMAIL_MESSAGE);
      return;
    }
    setFormatError('');
    onLogin(email, password);
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Nav ────────────────────────────────────────────────────────── */}
      <nav className="flex justify-between items-center px-6 py-4 border-b border-border sticky top-0 bg-background/90 backdrop-blur-md z-40">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-foreground flex items-center justify-center">
            <Dumbbell className="w-5 h-5 text-background" />
          </div>
          <span className="text-lg font-bold uppercase tracking-widest font-mono">IronTrack</span>
        </div>
        <div className="flex items-center space-x-2">
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={openLogin}
            data-testid="open-login-btn"
            className="flex items-center space-x-2 px-4 py-2 bg-foreground text-background text-[11px] font-bold font-mono uppercase tracking-widest hover:opacity-90 transition-opacity"
          >
            <LogIn className="w-4 h-4" />
            <span>Login</span>
          </motion.button>
          <button
            onClick={onToggleTheme}
            className="p-2 hover:bg-muted rounded-sm transition-colors"
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
        </div>
      </nav>

      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-border">
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none opacity-[0.04] [background-image:linear-gradient(to_right,currentColor_1px,transparent_1px),linear-gradient(to_bottom,currentColor_1px,transparent_1px)] [background-size:48px_48px]"
        />
        <div className="relative max-w-[1400px] mx-auto px-6 py-20 md:py-28 grid md:grid-cols-2 gap-12 items-center">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="flex items-center gap-3 mb-6">
              <span className="w-1.5 h-1.5 bg-accent rounded-full animate-fui-pulse" />
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
                System Online / V1
              </span>
            </div>
            <motion.h1
              initial="hidden"
              animate="visible"
              variants={{ visible: { transition: { staggerChildren: 0.12 } } }}
              className="text-7xl lg:text-9xl font-display font-bold uppercase leading-none"
            >
              {['IRON', 'TRACK'].map((word) => (
                <motion.span
                  key={word}
                  variants={{
                    hidden: { opacity: 0, y: 40 },
                    visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] } },
                  }}
                  className="block text-foreground"
                >
                  {word}
                </motion.span>
              ))}
            </motion.h1>
            <motion.div
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ delay: 0.4, duration: 0.6, ease: 'easeOut' }}
              className="h-px w-24 bg-primary mt-6 mb-8 origin-left"
            />
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5, duration: 0.6 }}
              className="text-sm font-mono uppercase tracking-[0.2em] text-muted-foreground"
            >
              Unified Training Management System
            </motion.p>
            <p className="text-foreground/80 mt-6 max-w-md leading-relaxed">
              The brutalist toolkit for serious coaches and athletes. Build periodized programs,
              log every set, and watch progress emerge from the data — no fluff, no fitness theatre.
            </p>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.65, duration: 0.5 }}
              className="flex gap-4 flex-wrap mt-10"
            >
              <Button variant="primary" size="md" onClick={openLogin} data-testid="hero-login-btn">
                Coach Login
              </Button>
              <Button variant="ghost" size="md" onClick={onSignup}>
                Trainee Signup
              </Button>
            </motion.div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="hidden md:block"
          >
            <TechnicalCard>
              <div className="flex items-center justify-between border-b border-border px-5 py-3 bg-muted/40">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 bg-foreground/40 rounded-full" />
                  <span className="w-2 h-2 bg-foreground/40 rounded-full" />
                  <span className="w-2 h-2 bg-foreground/40 rounded-full" />
                </div>
                <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
                  Session_Log // Week 04 / Day 02
                </span>
              </div>
              <div className="p-6 font-mono text-[11px] space-y-3">
                <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 text-muted-foreground uppercase tracking-widest text-[9px] border-b border-border pb-2">
                  <span>Exercise</span>
                  <span>Sets</span>
                  <span>Plan</span>
                  <span>Actual</span>
                </div>
                {SAMPLE_LOG_ROWS.map((row, i) => (
                  <div key={row.name} className="grid grid-cols-[1fr_auto_auto_auto] gap-4 items-center">
                    <span className="text-foreground">{row.name}</span>
                    <span className="text-muted-foreground">{row.sets}</span>
                    <span className="text-muted-foreground">{row.plan}</span>
                    <span className={i < 2 ? 'text-green-500 font-bold' : 'text-foreground'}>
                      {row.actual}
                    </span>
                  </div>
                ))}
                <div className="pt-3 border-t border-border flex justify-between text-[9px] uppercase tracking-widest text-muted-foreground">
                  <span>RPE_AVG = 7.8</span>
                  <span>VOLUME = 14,420 KG</span>
                </div>
              </div>
            </TechnicalCard>
          </motion.div>
        </div>
      </section>

      {/* ── For Coaches ────────────────────────────────────────────────── */}
      <section className="border-b border-border">
        <div className="max-w-[1400px] mx-auto px-6 py-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            className="flex items-end justify-between mb-12"
          >
            <div>
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">// 01</span>
              <h2 className="text-5xl md:text-6xl font-bold tracking-tighter uppercase italic font-serif text-foreground mt-2">
                For Coaches
              </h2>
              <p className="text-muted-foreground font-mono text-xs mt-3 uppercase tracking-widest">
                Operations Console
              </p>
            </div>
            <ShieldCheck className="hidden md:block w-12 h-12 text-foreground/30" />
          </motion.div>

          <div className="grid md:grid-cols-2 gap-5">
            {COACH_FEATURES.map((f, i) => (
              <motion.div
                key={f.label}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.05, duration: 0.3 }}
              >
                <TechnicalCard className="h-full hover:border-muted-foreground hover:-translate-y-1 transition-all">
                  <div className="p-7">
                    <div className="flex items-center justify-between mb-5">
                      <div className="w-12 h-12 bg-muted flex items-center justify-center">
                        <f.icon className="w-6 h-6" />
                      </div>
                      <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
                        /0{i + 1}
                      </span>
                    </div>
                    <h3 className="text-xl font-bold tracking-tight text-foreground mb-2">{f.label}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{f.body}</p>
                  </div>
                </TechnicalCard>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── For Trainees ───────────────────────────────────────────────── */}
      <section className="border-b border-border bg-muted/30">
        <div className="max-w-[1400px] mx-auto px-6 py-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            className="flex items-end justify-between mb-12"
          >
            <div>
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">// 02</span>
              <h2 className="text-5xl md:text-6xl font-bold tracking-tighter uppercase italic font-serif text-foreground mt-2">
                For Trainees
              </h2>
              <p className="text-muted-foreground font-mono text-xs mt-3 uppercase tracking-widest">
                Athlete Protocol
              </p>
            </div>
            <Activity className="hidden md:block w-12 h-12 text-foreground/30" />
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {TRAINEE_FEATURES.map((f, i) => (
              <motion.div
                key={f.label}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.05, duration: 0.3 }}
              >
                <TechnicalCard className="h-full hover:border-muted-foreground hover:-translate-y-1 transition-all">
                  <div className="p-6">
                    <div className="w-10 h-10 bg-foreground text-background flex items-center justify-center mb-5">
                      <f.icon className="w-5 h-5" />
                    </div>
                    <h3 className="text-lg font-bold tracking-tight text-foreground mb-2">{f.label}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{f.body}</p>
                  </div>
                </TechnicalCard>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Technical Playground ───────────────────────────────────────── */}
      <section className="border-b border-border">
        <div className="max-w-[1400px] mx-auto px-6 py-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            className="flex items-end justify-between mb-12"
          >
            <div>
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">// 03</span>
              <h2 className="text-5xl md:text-6xl font-bold tracking-tighter uppercase italic font-serif text-foreground mt-2 leading-[0.95]">
                The Technical<br />Playground
              </h2>
              <p className="text-muted-foreground font-mono text-xs mt-3 uppercase tracking-widest">
                Try the on-platform tools — no account required
              </p>
            </div>
            <Calculator className="hidden md:block w-12 h-12 text-foreground/30" />
          </motion.div>

          <motion.div
            initial="hidden"
            animate="visible"
            variants={{ visible: { transition: { staggerChildren: 0.08, delayChildren: 0.8 } } }}
            className="grid lg:grid-cols-3 gap-5"
          >
            {[
              { label: 'Plate Calculator', icon: Calculator, body: <PlateCalculator isInline /> },
              { label: 'RPE → 1RM',        icon: Gauge,      body: <RPECalculator />            },
              { label: 'DOTS Score',       icon: Trophy,     body: <PointsCalculator />         },
            ].map((tool, i) => (
              <motion.div
                key={tool.label}
                variants={{ hidden: { opacity: 0, y: 24 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5 } } }}
              >
                <TechnicalCard className="h-full">
                  <div className="border-b border-border bg-muted/30 px-5 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <tool.icon className="w-4 h-4" />
                      <span className="text-[10px] font-mono uppercase tracking-widest text-foreground">
                        {tool.label}
                      </span>
                    </div>
                    <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest">
                      /0{i + 1}
                    </span>
                  </div>
                  <div className="p-5">{tool.body}</div>
                </TechnicalCard>
              </motion.div>
            ))}
          </motion.div>

          {/* Conversion CTA — placed directly under the tools so the user
              hits it the moment they finish playing with one. */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.3 }}
            className="mt-8"
          >
            <TechnicalCard>
              <div className="px-6 py-5 flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="text-center md:text-left">
                  <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
                    Numbers are temporary in this view
                  </p>
                  <p className="text-base md:text-lg font-bold italic font-serif text-foreground mt-0.5">
                    Log in to keep them.
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={openLogin}
                    data-testid="playground-login-btn"
                    className="bg-foreground text-background px-6 py-3 text-xs font-bold uppercase tracking-widest flex items-center hover:opacity-90 shadow-lg"
                  >
                    <LogIn className="w-4 h-4 mr-2" />
                    Login
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={onSignup}
                    className="bg-background border border-border hover:border-foreground text-foreground px-6 py-3 text-xs font-bold uppercase tracking-widest flex items-center transition-colors"
                  >
                    <UserPlus className="w-4 h-4 mr-2" />
                    Sign Up
                  </motion.button>
                </div>
              </div>
            </TechnicalCard>
          </motion.div>
        </div>
      </section>

      {/* ── Philosophy ─────────────────────────────────────────────────── */}
      <section className="border-b border-border">
        <div className="max-w-[1400px] mx-auto px-6 py-20 grid md:grid-cols-2 gap-12 items-center">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4 }}
          >
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">// 04</span>
            <h2 className="text-5xl md:text-6xl font-bold tracking-tighter uppercase italic font-serif text-foreground mt-2 leading-[0.9]">
              Brutalist<br />by Design
            </h2>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4 }}
            className="space-y-5 text-foreground/80 leading-relaxed"
          >
            <p>
              Most fitness apps wrap your training in cartoon graphics, dopamine streaks, and gamified noise. IronTrack does not.
            </p>
            <p>
              Every interface element is structural — monospaced labels, sharp grid lines, plain numerical truth. The aesthetic is technical for a reason: when your hands are sweaty and you have ninety seconds before the next set, you do not need a celebration animation. You need to read your numbers.
            </p>
            <div className="grid grid-cols-3 pt-4 border-t border-border">
              {[
                { k: 'Density',   v: 'High' },
                { k: 'Latency',   v: 'Sub-100ms' },
                { k: 'Animation', v: 'Functional' },
              ].map((m) => (
                <div key={m.k} className="px-3 py-2 border-r last:border-r-0 border-border">
                  <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">{m.k}</p>
                  <p className="text-sm font-mono text-foreground mt-1">{m.v}</p>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Final CTA ──────────────────────────────────────────────────── */}
      <section className="border-b border-border">
        <div className="max-w-[1400px] mx-auto px-6 py-20 text-center">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4 }}
            className="text-5xl md:text-7xl font-bold tracking-tighter uppercase italic font-serif text-foreground"
          >
            Ready to train?
          </motion.h2>
          <p className="text-muted-foreground font-mono text-xs mt-4 uppercase tracking-widest">
            Authentication required to enter the system
          </p>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={openLogin}
            className="mt-10 bg-foreground text-background px-10 py-5 text-xs font-bold uppercase tracking-widest inline-flex items-center hover:opacity-90 shadow-lg"
          >
            <LogIn className="w-4 h-4 mr-2" />
            Login
            <ChevronRight className="w-4 h-4 ml-2" />
          </motion.button>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer className="px-6 py-6 flex flex-col md:flex-row justify-between items-center gap-2 text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
        <span>IronTrack © 2026 — All rights reserved</span>
        <span>Build: Stable / Tenant-Isolated / RLS-Enforced</span>
      </footer>

      {/* ── Login Modal ────────────────────────────────────────────────── */}
      <Modal isOpen={showLogin} onClose={closeLogin} title="Enter System">
        <div className="space-y-6">
          <div className="space-y-2">
            <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
              Email
            </label>
            <div className="field-wrap">
              <TechnicalInput
                value={email}
                onChange={setEmail}
                placeholder="you@example.com"
                type="email"
                data-testid="login-email"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
              Password
            </label>
            <div className="field-wrap">
              <TechnicalInput
                value={password}
                onChange={setPassword}
                placeholder="••••••••"
                type="password"
                data-testid="login-password"
              />
            </div>
          </div>

          {formatError && (
            <p className="text-red-500 font-mono text-xs" data-testid="login-format-error">{formatError}</p>
          )}
          {loginError && !formatError && (
            <p className="text-red-500 font-mono text-xs">{loginError}</p>
          )}

          <button
            onClick={handleSubmit}
            disabled={isBootstrapping}
            data-testid="login-btn"
            className="btn-press w-full bg-foreground text-background py-4 text-xs font-bold uppercase tracking-widest rounded-input hover:opacity-90 shadow-lg disabled:opacity-40 disabled:cursor-wait"
          >
            {isBootstrapping ? 'Initialising...' : 'Enter System'}
          </button>

          <div className="flex justify-between">
            <button
              onClick={() => { closeLogin(); onForgot(); }}
              data-testid="goto-forgot-btn"
              className="text-xs font-mono text-muted-foreground hover:text-foreground uppercase tracking-widest"
            >
              Forgot Password?
            </button>
            <button
              onClick={() => { closeLogin(); onSignup(); }}
              data-testid="goto-signup-btn"
              className="text-xs font-mono text-muted-foreground hover:text-foreground uppercase tracking-widest"
            >
              Sign Up
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─── Add Client Modal ────────────────────────────────────────────────────────

export function AddClientModal({
  isOpen,
  onClose,
  onAdd,
  tenantId,
}: {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (name: string, email: string, password: string, role: UserRole, tenantId?: string) => Promise<unknown>;
  tenantId?: string;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const reset = () => {
    setName(''); setEmail(''); setPassword(''); setConfirm('');
    setErrors([]); setSubmitting(false);
  };

  const handleClose = () => { reset(); onClose(); };

  const handleAdd = async () => {
    const errs: string[] = [];
    if (!name.trim())  errs.push('Name is required.');
    if (!email.trim()) errs.push('Email is required.');
    else if (!isValidEmail(email)) errs.push(INVALID_EMAIL_MESSAGE);

    const strength = checkPasswordStrength(password);
    if (!strength.ok) errs.push(...strength.errors.map((e) => `Password: ${e}`));
    if (password !== confirm) errs.push('Passwords do not match.');

    if (errs.length > 0) { setErrors(errs); return; }

    // Defensive: a coach without an explicit tenantId should never happen, but a
    // stale persisted session pre-Sprint-1 might lack one. Refuse to submit
    // rather than letting addClient throw deep in the call.
    if (!tenantId) {
      setErrors(['Cannot create a client: your account is missing a tenant. Sign out and back in.']);
      return;
    }

    setSubmitting(true);
    try {
      await onAdd(name.trim(), email.trim(), password, 'trainee', tenantId);
      reset();
      onClose();
    } catch (err) {
      // Surface the failure inline instead of leaving the modal frozen on
      // "Creating...". Console keeps the stack for debugging.
      console.error('AddClientModal: failed to create client', err);
      const message = err instanceof Error ? err.message : 'Could not create client. Please try again.';
      setErrors([message]);
    } finally {
      setSubmitting(false);
    }
  };

  const strength = checkPasswordStrength(password);

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="New Client">
      <div className="space-y-5">
        {[
          { label: 'Full Name', value: name,     set: setName,     placeholder: 'John Doe',          testId: 'new-client-name',     type: 'text' },
          { label: 'Email',     value: email,    set: setEmail,    placeholder: 'john@example.com',  testId: 'new-client-email',    type: 'email' },
          { label: 'Password',  value: password, set: setPassword, placeholder: 'Min 8 chars, 1 letter, 1 number', testId: 'new-client-password', type: 'password' },
          { label: 'Confirm Password', value: confirm, set: setConfirm, placeholder: '••••••••', testId: 'new-client-confirm', type: 'password' },
        ].map(({ label, value, set, placeholder, testId, type }) => (
          <div key={label} className="space-y-1.5">
            <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
              {label}
            </label>
            <div className="field-wrap">
              <TechnicalInput
                value={value}
                onChange={set}
                placeholder={placeholder}
                type={type}
                data-testid={testId}
              />
            </div>
          </div>
        ))}

        {/* Password strength indicator */}
        {password.length > 0 && (
          <div className="space-y-1">
            {strength.errors.map((e) => (
              <p key={e} className="text-[10px] font-mono text-amber-500">{e}</p>
            ))}
            {strength.ok && (
              <p className="text-[10px] font-mono text-green-500">Password meets requirements</p>
            )}
          </div>
        )}

        {/* Validation errors */}
        {errors.length > 0 && (
          <div className="space-y-1">
            {errors.map((e) => (
              <p key={e} className="text-[10px] font-mono text-red-500">{e}</p>
            ))}
          </div>
        )}

        <button
          onClick={handleAdd}
          disabled={submitting}
          className="btn-press w-full bg-foreground text-background py-4 text-xs font-bold uppercase tracking-widest rounded-input hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? 'Creating...' : 'Create Client'}
        </button>
      </div>
    </Modal>
  );
}

// ─── App Shell (authenticated layout) ───────────────────────────────────────

function AppShell({
  children,
  authenticatedUser,
  theme,
  onToggleTheme,
  onLogout,
  onGoAdmin,
  impersonating,
  onStopImpersonating,
  toast,
  onDismissToast,
  onUpdateUser,
  onOpenCommandPalette,
  commandPalette,
}: {
  children: React.ReactNode;
  authenticatedUser: Client;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onLogout: () => void;
  onGoAdmin: () => void;
  impersonating?: Client | null;
  onStopImpersonating?: () => void;
  toast?: string | null;
  onDismissToast?: () => void;
  onUpdateUser: (patch: Partial<Client>) => void;
  onOpenCommandPalette?: () => void;
  commandPalette?: React.ReactNode;
}) {
  const [showSettings, setShowSettings] = useState(false);

  // Online/offline detection — drives the warning banner at the top of
  // every authenticated screen. The hook lives in AppShell rather than App
  // so the banner is rendered above the impersonation banner inside every
  // shell-wrapped view (admin / dashboard / coach roster / superadmin)
  // without each branch having to opt in.
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Offline banner — fixed-top so it overlays the rest of the chrome
          rather than pushing layout down when connectivity flips. */}
      {!isOnline && (
        <div
          role="alert"
          data-testid="offline-banner"
          className="fixed top-0 left-0 right-0 z-[9999] bg-warning/10 border-b border-warning/40 px-4 py-2 flex items-center justify-center gap-2"
        >
          <WifiOff className="w-3.5 h-3.5 text-warning shrink-0" />
          <span className="text-[10px] font-mono uppercase tracking-widest text-warning">
            No connection — changes may not save until you're back online
          </span>
        </div>
      )}

      {/* Impersonation banner */}
      {impersonating && (
        <div className="bg-amber-600 text-white px-4 py-2 text-xs font-mono uppercase tracking-widest flex justify-between items-center">
          <span>Viewing as: {authenticatedUser.name} (Tenant: {authenticatedUser.tenantId})</span>
          <button
            onClick={onStopImpersonating}
            data-testid="stop-impersonate-btn"
            className="flex items-center gap-2 px-3 py-1 border border-white/30 hover:bg-white/20 transition-colors"
          >
            <ArrowLeft className="w-3 h-3" />
            Back to Superadmin
          </button>
        </div>
      )}
      <nav className="flex justify-between items-center px-8 py-4 border-b border-border sticky top-0 bg-background/95 backdrop-blur-md z-50">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-foreground flex items-center justify-center">
            <Dumbbell className="w-5 h-5 text-background" />
          </div>
          <span className="text-lg font-bold uppercase tracking-widest font-mono">IronTrack</span>
        </div>
        <div className="flex items-center space-x-4">
          <button
            onClick={() => setShowSettings(true)}
            className="text-xs font-mono text-muted-foreground hover:text-primary transition-colors hidden sm:block"
            data-testid="open-settings-btn"
          >
            {authenticatedUser.name}
          </button>
          {onOpenCommandPalette && (
            <button
              type="button"
              onClick={onOpenCommandPalette}
              aria-label="Open command palette"
              data-testid="command-palette-trigger"
              className="hidden md:inline-flex items-center gap-1 px-2 py-1 border border-border/50 hover:border-primary/60 transition-colors font-mono text-[9px] uppercase tracking-widest text-muted-foreground/70 hover:text-primary"
            >
              <span>⌘</span><span>K</span>
            </button>
          )}
          {authenticatedUser.role === 'admin' && (
            <button
              onClick={onGoAdmin}
              data-testid="admin-btn"
              className="flex items-center space-x-2 px-4 py-2 border border-border hover:border-muted-foreground text-xs font-mono uppercase transition-colors"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Admin</span>
            </button>
          )}
          <button onClick={onToggleTheme} className="p-2 hover:bg-muted rounded-sm transition-colors">
            {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
          <button
            onClick={onLogout}
            className="p-2 hover:bg-muted rounded-sm transition-colors text-muted-foreground hover:text-foreground"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </nav>
      <motion.main
        key={authenticatedUser.id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
        className="flex-1 p-8 max-w-[1600px] mx-auto w-full"
      >
        {children}
      </motion.main>
      <Toast message={toast ?? null} onDismiss={onDismissToast} />
      {commandPalette}
      {showSettings && authenticatedUser && (
        <AccountSettings
          user={authenticatedUser}
          onClose={() => setShowSettings(false)}
          onUpdated={(newName) => {
            onUpdateUser({ name: newName });
            setShowSettings(false);
          }}
        />
      )}
    </div>
  );
}

// ─── Root App ────────────────────────────────────────────────────────────────

export default function App() {
  // Native deep-link listener — no-op on web.
  useDeepLinks();
  const { authenticatedUser, view, loginError, isLoading: isAuthLoading, login, logout, setView, impersonating, impersonate, stopImpersonating, patchAuthenticatedUser } = useAuth();
  const commandPalette = useCommandPalette();
  const {
    clients,
    isLoadingData,
    refetch,
    addClient,
    saveProgram,
    saveSession,
    archiveProgram,
    deleteClient,
    createProgram,
    createProgramFromTemplate,
    duplicateProgram,
    saveBlockNotes,
    appendClient,
    getClientsForTenant,
  } = useProgramData(authenticatedUser);

  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [activeWorkout, setActiveWorkout] = useState<{ week: WorkoutWeek; day: WorkoutDay } | null>(null);
  const [isAddClientOpen, setIsAddClientOpen] = useState(false);
  // Set immediately after a successful Finish Workout. While non-null, the
  // PostWorkoutReflectionModal is shown over the dashboard; clearing it
  // (skip or submit) returns the trainee to a clean dashboard.
  const [pendingReflection, setPendingReflection] = useState<
    | { clientId: string; programId: string; weekId: string; day: WorkoutDay }
    | null
  >(null);
  // Lazy initializer reads the saved preference SYNCHRONOUSLY before the
  // theme-persist effect runs. The previous "set default 'dark', then a
  // useEffect reads localStorage on mount" pattern was racy: the persist
  // effect (declared earlier) overwrote the saved value with the default
  // before the restore effect could read it back.
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window === 'undefined') return 'dark';
    const saved = window.localStorage.getItem('irontrack_theme');
    return saved === 'light' || saved === 'dark' ? saved : 'dark';
  });
  const [toast, setToast] = useState<string | null>(null);

  // Auto-dismiss the toast 3s after it's shown. The effect re-runs when
  // `toast` changes, so triggering a new toast resets the timer cleanly.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const dismissToast = () => setToast(null);

  // Apply theme class to <html> and persist on change. The initial value
  // already came from localStorage via the useState lazy initializer above,
  // so this effect is purely "react to user-driven changes."
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.classList.toggle('light', theme === 'light');
    localStorage.setItem('irontrack_theme', theme);

    // Native: tint the system status bar to match the active theme so the
    // Android pull-down area doesn't sit as a light strip on a dark UI (or
    // vice versa). Lazy-import keeps the web build from pulling in the
    // plugin unnecessarily.
    if (isNative()) {
      // Match the actual --color-background CSS variables: zinc-950 for dark,
      // zinc-50 for light. Off-by-one hex codes here produce a one-pixel
      // colour seam between the system bar and the app surface.
      void import('@capacitor/status-bar').then(({ StatusBar, Style }) => {
        void StatusBar.setStyle({ style: theme === 'dark' ? Style.Dark : Style.Light }).catch(() => {});
        void StatusBar.setBackgroundColor({
          color: theme === 'dark' ? '#09090b' : '#fafafa',
        }).catch(() => {});
      }).catch(() => {});
    }
  }, [theme]);

  // Auto keep-awake while a workout is in progress. Released when the workout
  // is finished (activeWorkout flips to null), the user navigates away, or
  // App unmounts — the cleanup runs in all three cases.
  //
  // Native-only: the manual "Gym Mode" toggle in ClientDashboard handles the
  // web-side wakeLock through useWakeLock; this effect intentionally avoids
  // contending with that hook on web.
  useEffect(() => {
    if (!activeWorkout || !isNative()) return;
    void KeepAwake.keepAwake().catch(() => {});
    return () => {
      void KeepAwake.allowSleep().catch(() => {});
    };
  }, [activeWorkout]);

  // Hold the native splash screen until the auth session AND the program
  // data are both hydrated. Without this, the splash auto-hides at ~800ms
  // and reveals an empty white frame for the duration of the Supabase round
  // trip. Paired with `launchAutoHide: false` in capacitor.config.ts.
  //
  // SplashScreen.hide() is idempotent, so the effect re-firing once both
  // flags settle is safe; we still gate on isNative() so the web build
  // never resolves the optional package.
  useEffect(() => {
    if (!isNative()) return;
    if (isAuthLoading || isLoadingData) return;
    void import('@capacitor/splash-screen').then(({ SplashScreen }) => {
      void SplashScreen.hide().catch(() => {});
    }).catch(() => {});
  }, [isAuthLoading, isLoadingData]);

  // Magic-link routing now happens synchronously inside useAuth's state
  // initializer — no effect needed here.

  // ─── Browser back-button sync ────────────────────────────────────────────
  //
  // We snapshot the three pieces of navigation-relevant state (view +
  // selectedClient + activeWorkout keys) into history.state on every change
  // and restore them on popstate. A ref breaks the popstate → setState → push
  // feedback loop. The key insight: history.state is keyed by entry, so
  // back/forward navigation transparently reads the right snapshot.

  type RouteSnapshot = {
    view: typeof view;
    selectedClientId: string | null;
    activeWorkout: { weekId: string; dayId: string } | null;
  };
  const skipNextPushRef = useRef(false);
  const initialMountRef = useRef(true);

  // Capture snapshot whenever navigation state changes.
  useEffect(() => {
    const snapshot: RouteSnapshot = {
      view,
      selectedClientId: selectedClient?.id ?? null,
      activeWorkout: activeWorkout
        ? { weekId: activeWorkout.week.id, dayId: activeWorkout.day.id }
        : null,
    };
    if (initialMountRef.current) {
      initialMountRef.current = false;
      window.history.replaceState({ irontrack: snapshot }, '');
      return;
    }
    if (skipNextPushRef.current) {
      skipNextPushRef.current = false;
      return;
    }
    window.history.pushState({ irontrack: snapshot }, '');
  }, [view, selectedClient?.id, activeWorkout]);

  // Restore snapshot on browser back/forward.
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const s = (e.state && (e.state as { irontrack?: RouteSnapshot }).irontrack) || null;
      if (!s) return;
      // Tell the push effect to skip the next render — we're being driven by
      // the browser, not by the user.
      skipNextPushRef.current = true;
      setView(s.view);
      if (s.selectedClientId == null) {
        setSelectedClient(null);
      } else {
        const target = clients.find((c) => c.id === s.selectedClientId);
        setSelectedClient(target ?? null);
      }
      if (s.activeWorkout == null) {
        setActiveWorkout(null);
      } else {
        const target = clients.find((c) => c.id === s.selectedClientId);
        const program =
          target?.programs.find((p) => p.id === target.activeProgramId && p.status !== 'archived') ??
          target?.programs.find((p) => p.status !== 'archived');
        if (!program) return; // no restorable program — leave current workout state unchanged
        const week = program?.weeks.find((w) => w.id === s.activeWorkout!.weekId);
        const day = week?.days.find((d) => d.id === s.activeWorkout!.dayId);
        setActiveWorkout(week && day ? { week, day } : null);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [clients, setView]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  const handleLogin = async (email: string, password: string) => {
    await login(email, password);
  };

  const handleSignupComplete = async (
    name: string,
    email: string,
    password: string,
    tenantId: string,
    inviteCode: string,
  ) => {
    // Defensive: empty tenantId would mean a corrupt invite slipped through.
    if (!tenantId || !tenantId.trim()) {
      const err = new Error(`handleSignupComplete: tenantId is required (got "${tenantId}"). The invite code may be corrupt.`);
      console.error('[IronTrack signup]', err);
      throw err;
    }
    if (!inviteCode || !inviteCode.trim()) {
      const err = new Error('handleSignupComplete: inviteCode is required.');
      console.error('[IronTrack signup]', err);
      throw err;
    }
    try {
      // Trainee signup flows through /api/signup-user instead of
      // supabase.auth.signUp. The serverless function uses the service-role
      // key to call admin.createUser({ email_confirm: true }), which skips
      // the inbox-confirmation hurdle so the OTP step IS the verification
      // gate. The service-role key never leaves the server.
      //
      // The endpoint VERIFIES the inviteCode server-side (it must exist,
      // resolve to the requested tenantId, and not be exhausted). Without
      // this gate, any unauthenticated caller could create trainees in
      // arbitrary tenants by guessing tenantIds.
      const normalizedEmail = email.trim().toLowerCase();
      const response = await fetch('/api/signup-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: normalizedEmail,
          password,
          tenantId: tenantId.trim(),
          inviteCode: inviteCode.trim(),
        }),
      });

      let payload: { profile?: unknown; error?: string } = {};
      try {
        payload = await response.json();
      } catch {
        // Non-JSON body — fall through with an empty payload so the !ok
        // branch below surfaces a generic error instead of a parse trace.
      }

      if (!response.ok) {
        throw new Error(payload.error || `Signup failed (HTTP ${response.status}).`);
      }

      // Auto-login. The user's email is already confirmed server-side, so
      // signInWithPassword succeeds and onAuthStateChange in useAuth picks
      // up the session, hydrates authenticatedUser, and routes to /trainee.
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });
      if (signInErr) {
        console.error('[IronTrack signup] auto sign-in failed', signInErr);
        throw new Error(signInErr.message);
      }
    } catch (err) {
      console.error('[IronTrack signup] failure', err);
      const message = err instanceof Error ? err.message : 'Signup failed. Please try again.';
      setToast(message);
      throw err instanceof Error ? err : new Error(message);
    }
  };

  /** Silent autosave — persists actuals without setting day.logged_at and
   *  without exiting the workout view. Called by the WorkoutGridLogger
   *  after every keystroke (debounced internally). */
  const handleAutoSaveSession = async (updatedDay: WorkoutDay): Promise<void> => {
    if (!selectedClient || !activeWorkout) return;
    const programById = selectedClient.programs.find(
      (p) => p.id === selectedClient.activeProgramId,
    );
    // If the active program was archived mid-workout, bail silently — this is
    // a background autosave and spamming a toast on every keystroke would be
    // jarring. The user will be informed when they try to finish the session.
    if (programById?.status === 'archived') return;
    const program =
      programById ??
      selectedClient.programs.find((p) => p.status !== 'archived');
    if (!program) return;
    await saveSession(
      selectedClient.id,
      program.id,
      activeWorkout.week.id,
      updatedDay,
      { markComplete: false },
    );
  };

  /** Explicit "Finish Workout" — stamps day.logged_at, exits the logger,
   *  and queues the post-workout reflection modal. The toast is deferred
   *  until the trainee skips or submits the reflection so the two pieces
   *  of feedback don't compete for attention. */
  const handleFinishSession = async (updatedDay: WorkoutDay): Promise<void> => {
    if (!selectedClient || !activeWorkout) return;
    const programById = selectedClient.programs.find(
      (p) => p.id === selectedClient.activeProgramId,
    );
    // If the coach archived this program while the trainee was mid-workout,
    // refuse to save the session so data doesn't get written to an archived
    // program where it won't appear in analytics.
    if (programById?.status === 'archived') {
      setToast('Your program was archived by your coach. Please contact them before continuing.');
      return;
    }
    const program =
      programById ??
      selectedClient.programs.find((p) => p.status !== 'archived');
    if (!program) return;
    await saveSession(
      selectedClient.id,
      program.id,
      activeWorkout.week.id,
      updatedDay,
      { markComplete: true },
    );
    // Hold a snapshot of the just-finished session so the reflection modal
    // can persist its difficulty/note onto the right `days` row even after
    // activeWorkout is cleared.
    setPendingReflection({
      clientId: selectedClient.id,
      programId: program.id,
      weekId: activeWorkout.week.id,
      day: { ...updatedDay, loggedAt: new Date().toISOString() },
    });
    setActiveWorkout(null);
  };

  /** Sibling of handleFinishSession that intentionally does NOT queue the
   *  reflection modal. Wired to the WorkoutSummary's "Close Without
   *  Reflection" path — the trainee already consumed the celebratory
   *  summary and doesn't want a second feedback prompt. The session is
   *  still persisted with markComplete: true so the day shows up as
   *  logged in the dashboard. */
  const handleFinishSessionSilent = async (updatedDay: WorkoutDay): Promise<void> => {
    if (!selectedClient || !activeWorkout) return;
    const programById = selectedClient.programs.find(
      (p) => p.id === selectedClient.activeProgramId,
    );
    if (programById?.status === 'archived') {
      setToast('Your program was archived by your coach. Please contact them before continuing.');
      return;
    }
    const program =
      programById ??
      selectedClient.programs.find((p) => p.status !== 'archived');
    if (!program) return;
    await saveSession(
      selectedClient.id,
      program.id,
      activeWorkout.week.id,
      updatedDay,
      { markComplete: true },
    );
    setActiveWorkout(null);
    setToast('Workout finished — well done!');
  };

  const handleReflectionSubmit = async (difficulty: number, note: string): Promise<void> => {
    const ctx = pendingReflection;
    if (!ctx) return;
    try {
      await saveSession(
        ctx.clientId,
        ctx.programId,
        ctx.weekId,
        ctx.day,
        { markComplete: false, reflection: { difficulty, note } },
      );
      setToast('Workout finished — reflection captured.');
    } catch (err) {
      console.error('[IronTrack] reflection save failed', err);
      setToast('Could not save reflection — try again from the dashboard.');
    } finally {
      setPendingReflection(null);
    }
  };

  const handleReflectionSkip = () => {
    setPendingReflection(null);
    setToast('Workout finished — well done!');
  };

  const handleAddCoach = async (name: string, email: string, password: string): Promise<Client> => {
    // Coach creation runs through /api/admin-create-user because
    // supabase.auth.admin.createUser requires the service-role key, which
    // must NEVER reach the browser bundle. The endpoint creates the auth
    // user, lets the on_auth_user_created trigger insert the profiles row,
    // then repoints tenant_id at the new user (a coach is the root of their
    // own tenant) and returns the resulting profile.
    //
    // The endpoint requires a Bearer token so it can verify the caller's
    // role server-side — without this header, anyone with the URL could
    // mint coach accounts. Forward the current session's access token.
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) {
      throw new Error('You must be logged in to create a coach.');
    }
    const response = await fetch('/api/admin-create-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ name, email, password }),
    });

    let payload: { profile?: { id: string; name: string; email: string; role: Client['role']; tenant_id: string | null; active_program_id: string | null }; error?: string } = {};
    try {
      payload = await response.json();
    } catch {
      // Non-JSON body — fall through with empty payload so the !ok branch
      // surfaces a generic error instead of a JSON parse trace.
    }

    if (!response.ok || !payload.profile) {
      throw new Error(payload.error || `Failed to create coach (HTTP ${response.status}).`);
    }

    const profile = payload.profile;
    const newCoach: Client = {
      id: profile.id,
      name: profile.name,
      email: profile.email,
      role: profile.role,
      tenantId: profile.tenant_id ?? undefined,
      activeProgramId: profile.active_program_id ?? undefined,
      programs: [],
    };
    appendClient(newCoach);
    setToast('Coach created successfully');
    return newCoach;
  };

  // Keep selectedClient in sync with the clients store (e.g. after coach edits)
  useEffect(() => {
    if (selectedClient) {
      const refreshed = clients.find((c) => c.id === selectedClient.id);
      if (refreshed) setSelectedClient(refreshed);
    }
  }, [clients]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-set selectedClient for trainees on login
  useEffect(() => {
    if (authenticatedUser?.role === 'trainee') {
      const fresh = clients.find((c) => c.id === authenticatedUser.id);
      if (fresh) setSelectedClient(fresh);
    }
  }, [authenticatedUser, clients]);

  // Auto-resubscribe trainees to Web Push when they land on their dashboard
  // and have already granted notification permission. The browser-side
  // subscription is per-device and non-portable, so re-asking the user to
  // opt in on each visit would be hostile — when permission is already
  // 'granted' we silently re-register so the server-side push column stays
  // in sync (e.g. after a logout/login that wiped the row, or a different
  // browser the trainee is now using).
  //
  // 'denied' / 'default' permission states are intentionally ignored —
  // calling subscribeToPush would prompt mid-flow, which is a worse UX
  // than the explicit "Enable Notifications" button on the dashboard.
  useEffect(() => {
    if (view !== 'trainee' || !authenticatedUser) return;
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      subscribeToPush(authenticatedUser.id).catch(console.error);
    }
  }, [view, authenticatedUser]);

  // Tenant-scoped clients for the current user
  const tenantClients = authenticatedUser ? getClientsForTenant(authenticatedUser) : [];

  // Command palette node — constructed once, passed as a slot to AppShell so
  // it overlays on top of every authenticated view. Wiring lives here because
  // setView / setSelectedClient / role are all App-level concerns.
  const paletteNode = authenticatedUser ? (
    <CommandPalette
      isOpen={commandPalette.isOpen}
      onClose={commandPalette.close}
      clients={tenantClients}
      onSelectClient={(c) => {
        setSelectedClient(c);
        setView('coach');
        commandPalette.close();
      }}
      onGoCoach={() => { setView('coach'); commandPalette.close(); }}
      onGoSuperadmin={
        authenticatedUser.role === 'superadmin'
          ? () => { setView('superadmin'); commandPalette.close(); }
          : undefined
      }
    />
  ) : null;

  // ── Signup ──────────────────────────────────────────────────────────────

  if (view === 'signup') {
    return (
      <>
        <SignupPage
          onComplete={handleSignupComplete}
          onBack={() => setView('landing')}
          theme={theme}
          onToggleTheme={toggleTheme}
          existingEmails={clients.map((c) => c.email)}
        />
        <Toast message={toast ?? null} onDismiss={dismissToast} />
      </>
    );
  }

  // ── Forgot Password ──────────────────────────────────────────────────

  if (view === 'forgot') {
    return (
      <>
        <ForgotPasswordPage
          onBack={() => setView('landing')}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
        <Toast message={toast ?? null} onDismiss={dismissToast} />
      </>
    );
  }

  // ── Landing / Login ────────────────────────────────────────────────────

  if (!authenticatedUser || view === 'landing') {
    return (
      <>
        <LandingPage
          onLogin={handleLogin}
          onSignup={() => setView('signup')}
          onForgot={() => setView('forgot')}
          loginError={loginError}
          isBootstrapping={isAuthLoading}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
        <Toast message={toast ?? null} onDismiss={dismissToast} />
      </>
    );
  }

  // ── Data load error gate ───────────────────────────────────────────────
  // The hook swallows fetch failures (logs + setClients([])), which leaves
  // an empty roster looking identical to a brand-new account. For
  // authenticated trainees / coaches who *should* have data, that's a
  // confusing zero-state. Surface a recoverable banner instead so the
  // user knows it was a transient failure and can retry. Superadmin is
  // legitimately empty when no coaches exist yet, so they're excluded.
  if (
    authenticatedUser
    && !isLoadingData
    && clients.length === 0
    && authenticatedUser.role !== 'superadmin'
  ) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-8">
        <div className="relative border border-warning/40 bg-surface p-8 max-w-sm w-full space-y-4 text-center">
          <span className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-warning/60" />
          <span className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-warning/60" />
          <span className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 border-warning/60" />
          <span className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-warning/60" />
          <p className="text-[10px] font-mono uppercase tracking-widest text-warning/70">Connection Issue</p>
          <p className="font-display font-bold uppercase text-lg text-foreground">Could not load your data</p>
          <p className="font-mono text-xs text-muted-foreground">Check your connection and try again.</p>
          <button
            onClick={() => void refetch()}
            data-testid="data-error-retry-btn"
            className="w-full py-3 border border-warning text-warning font-mono text-xs uppercase tracking-widest hover:bg-warning/10 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ── Superadmin view ────────────────────────────────────────────────────

  if (view === 'superadmin' && authenticatedUser.role === 'superadmin') {
    return (
      <AppShell
        authenticatedUser={authenticatedUser}
        theme={theme}
        onToggleTheme={toggleTheme}
        onLogout={logout}
        onUpdateUser={patchAuthenticatedUser}
        onOpenCommandPalette={commandPalette.open}
        commandPalette={paletteNode}
        toast={toast}
        onDismissToast={dismissToast}
        onGoAdmin={() => {}}
      >
        <SuperadminView
          clients={clients}
          onAddCoach={handleAddCoach}
          onImpersonate={impersonate}
        />
      </AppShell>
    );
  }

  // ── Active workout logger ──────────────────────────────────────────────

  if (activeWorkout && selectedClient) {
    const program =
      selectedClient.programs.find((p) => p.id === selectedClient.activeProgramId && p.status !== 'archived') ??
      selectedClient.programs.find((p) => p.status !== 'archived') ??
      selectedClient.programs[0];

    return (
      <AppShell
        authenticatedUser={authenticatedUser}
        theme={theme}
        onToggleTheme={toggleTheme}
        onLogout={logout}
        onUpdateUser={patchAuthenticatedUser}
        onOpenCommandPalette={commandPalette.open}
        commandPalette={paletteNode}
        toast={toast}
        onDismissToast={dismissToast}
        onGoAdmin={() => setView('admin')}
        impersonating={impersonating}
        onStopImpersonating={stopImpersonating}
      >
        <WorkoutGridLogger
          client={selectedClient}
          program={program}
          week={activeWorkout.week}
          day={activeWorkout.day}
          onBack={() => setActiveWorkout(null)}
          onAutoSave={handleAutoSaveSession}
          onFinish={handleFinishSession}
          onFinishSilent={handleFinishSessionSilent}
        />
        <RestTimer />
      </AppShell>
    );
  }

  // ── Admin view ─────────────────────────────────────────────────────────

  if (view === 'admin') {
    if (authenticatedUser.role !== 'admin' && authenticatedUser.role !== 'superadmin') {
      setView('trainee');
      return null;
    }
    return (
      <AppShell
        authenticatedUser={authenticatedUser}
        theme={theme}
        onToggleTheme={toggleTheme}
        onLogout={logout}
        onUpdateUser={patchAuthenticatedUser}
        onOpenCommandPalette={commandPalette.open}
        commandPalette={paletteNode}
        toast={toast}
        onDismissToast={dismissToast}
        onGoAdmin={() => setView('admin')}
        impersonating={impersonating}
        onStopImpersonating={stopImpersonating}
      >
        <AdminView
          clients={clients}
          authenticatedUser={authenticatedUser}
          isLoadingData={isLoadingData}
          onSaveProgram={saveProgram}
          onCreateProgram={createProgram}
          onCreateProgramFromTemplate={createProgramFromTemplate}
          onDuplicateProgram={async (clientId, program) => duplicateProgram(clientId, program)}
          onSaveBlockNotes={saveBlockNotes}
          onDeleteClient={deleteClient}
          onArchiveProgram={archiveProgram}
          onSendNotification={async (clientId, message) => {
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;
            if (!token) {
              setToast('You must be signed in to send notifications.');
              return;
            }
            try {
              const res = await fetch('/api/send-notification', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ recipientId: clientId, message }),
              });
              if (!res.ok) {
                const payload = await res.json().catch(() => ({} as { error?: string }));
                throw new Error(payload.error || `Send failed (HTTP ${res.status})`);
              }
              setToast('Notification sent');
            } catch (err) {
              console.error('[IronTrack] sendNotification failed', err);
              setToast(err instanceof Error ? err.message : 'Could not send notification.');
            }
          }}
          onBack={() => {
            if (impersonating) {
              stopImpersonating();
            } else {
              setView('coach');
            }
          }}
        />
      </AppShell>
    );
  }

  // ── Client dashboard (trainee or coach drilling into a client) ─────────

  if (selectedClient && (view === 'trainee' || view === 'coach')) {
    return (
      <>
        <AppShell
          authenticatedUser={authenticatedUser}
          theme={theme}
          onToggleTheme={toggleTheme}
          onLogout={logout}
          onUpdateUser={patchAuthenticatedUser}
          onOpenCommandPalette={commandPalette.open}
          commandPalette={paletteNode}
          toast={toast}
          onDismissToast={dismissToast}
          onGoAdmin={() => setView('admin')}
          impersonating={impersonating}
          onStopImpersonating={stopImpersonating}
        >
          <ClientDashboard
            client={selectedClient}
            // Coaches drilling into a client (or superadmins impersonating a
            // coach drilled into a client) get a back arrow that returns to
            // the client list. Trainees viewing their OWN dashboard get
            // `undefined` — there's no parent view to go back to, and the
            // arrow used to call logout() which trainees confused for a
            // navigation gesture. Logout lives in the X icon up top.
            onBack={
              authenticatedUser.role === 'admin' || impersonating
                ? () => {
                    setSelectedClient(null);
                    setView('coach');
                  }
                : undefined
            }
            onStartWorkout={(week, day) => setActiveWorkout({ week, day })}
          />
        </AppShell>
        <PostWorkoutReflectionModal
          isOpen={pendingReflection !== null}
          dayName={pendingReflection?.day.name}
          onSubmit={handleReflectionSubmit}
          onSkip={handleReflectionSkip}
        />
      </>
    );
  }

  // ── Coach: client list ─────────────────────────────────────────────────

  if (authenticatedUser.role !== 'admin' && !impersonating) {
    // Trainee with no selectedClient yet (edge case during bootstrap)
    return null;
  }

  return (
    <AppShell
      authenticatedUser={authenticatedUser}
      theme={theme}
      onToggleTheme={toggleTheme}
      onLogout={logout}
      onUpdateUser={patchAuthenticatedUser}
      onOpenCommandPalette={commandPalette.open}
      commandPalette={paletteNode}
      toast={toast}
      onDismissToast={dismissToast}
      onGoAdmin={() => setView('admin')}
      impersonating={impersonating}
      onStopImpersonating={stopImpersonating}
    >
      <AnimatePresence mode="wait">
        <ClientListView
          clients={tenantClients}
          onSelectClient={(c) => { setSelectedClient(c); setView('coach'); }}
          onAddClient={() => setIsAddClientOpen(true)}
        />
      </AnimatePresence>
      <AddClientModal
        isOpen={isAddClientOpen}
        onClose={() => setIsAddClientOpen(false)}
        onAdd={addClient}
        tenantId={authenticatedUser.tenantId ?? authenticatedUser.id}
      />
    </AppShell>
  );
}