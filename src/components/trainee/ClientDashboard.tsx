import { useState, useMemo, useEffect } from 'react';
import { ArrowLeft, AlertCircle, Smartphone, Archive, Play, CheckCircle2, Circle, ArrowRight, Bell, BellOff, Video, Eye, FileText } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { TechnicalCard } from '../ui';
import { cn } from '../../lib/utils';
import { useWakeLock } from '../../hooks/useWakeLock';
import { hapticNav } from '../../lib/haptics';
import { AnalyticsDashboard } from './AnalyticsDashboard';
import { WorkoutHistoryModal } from './WorkoutHistoryModal';
import { ProgressReport } from './ProgressReport';
import { detectDeloadWeek } from '../../lib/analytics';
import type { Client, Program, WorkoutWeek, WorkoutDay } from '../../types';

interface ClientDashboardProps {
  client: Client;
  /** Where the back arrow takes the user. Pass `undefined` when the
   *  current user has no parent view (a trainee viewing their own
   *  dashboard) — the arrow is then hidden so it can't be confused for
   *  a logout shortcut. The X in the AppShell nav is the canonical
   *  logout entry point. */
  onBack?: () => void;
  onStartWorkout: (week: WorkoutWeek, day: WorkoutDay) => void;
}

type Tab = 'current' | 'history' | 'analytics';

export function ClientDashboard({ client, onBack, onStartWorkout }: ClientDashboardProps) {
  const activeProgram =
    client.programs.find((p) => p.id === client.activeProgramId && p.status !== 'archived') ??
    client.programs.find((p) => p.status !== 'archived') ??
    null;

  const archivedPrograms = client.programs.filter((p) => p.status === 'archived');

  const TABS: Tab[] = ['current', 'history', 'analytics'];
  const [tab, setTab] = useState<Tab>('current');
  const tabIndex = TABS.indexOf(tab);

  const [showReport, setShowReport] = useState(false);

  // Smart-resume target: the next workout the trainee should do. Find the
  // first day without a `loggedAt` in the chronologically next week. If
  // every day across the program is logged, fall back to the very last day
  // so the user can re-log it. If there are no weeks at all, leaves both
  // null and the hero shows the empty state.
  const resumeTarget = useMemo(() => {
    if (!activeProgram) return null;
    const weeksSorted = [...activeProgram.weeks].sort((a, b) => a.weekNumber - b.weekNumber);
    for (const w of weeksSorted) {
      const daysSorted = [...w.days].sort((a, b) => a.dayNumber - b.dayNumber);
      const next = daysSorted.find((d) => !d.loggedAt);
      if (next) return { week: w, day: next };
    }
    // Fully logged — point at the last day of the last week.
    const lastWeek = weeksSorted[weeksSorted.length - 1];
    const lastDay = lastWeek?.days[lastWeek.days.length - 1];
    if (lastWeek && lastDay) return { week: lastWeek, day: lastDay };
    return null;
  }, [activeProgram]);

  // Initial week selection: prefer the resume week, fall back to week 1.
  const [selectedWeekId, setSelectedWeekId] = useState<string | undefined>(
    resumeTarget?.week.id ?? activeProgram?.weeks[0]?.id,
  );

  const [historyDay, setHistoryDay] = useState<WorkoutDay | null>(null);

  const wakeLock = useWakeLock();

  // Notification permission — read once on mount, then re-read after every
  // requestPermission() round-trip. 'unsupported' covers iOS Safari < 16.4
  // and other browsers without Notification API; we just hide the button.
  type NotifState = NotificationPermission | 'unsupported';
  const [notifPermission, setNotifPermission] = useState<NotifState>('unsupported');
  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    setNotifPermission(Notification.permission);
  }, []);

  const requestNotifications = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'default') {
      // Already granted or denied — repeat calls are no-ops in browsers,
      // but resync local state in case the user changed it via OS settings.
      setNotifPermission(Notification.permission);
      return;
    }
    try {
      const result = await Notification.requestPermission();
      setNotifPermission(result);
    } catch (err) {
      console.warn('[IronTrack] Notification.requestPermission failed', err);
    }
  };

  return (
    <div className="space-y-10">
      {/* Header */}
      <header className="flex justify-between items-end">
        <div className="flex items-center space-x-4 md:space-x-8">
          {onBack && (
            <motion.button
              whileHover={{ x: -4 }}
              onClick={onBack}
              aria-label="Back"
              data-testid="dashboard-back-btn"
              className="p-3 hover:bg-muted transition-colors rounded-sm"
            >
              <ArrowLeft className="w-7 h-7 md:w-8 md:h-8 text-foreground" />
            </motion.button>
          )}
          <div>
            <h1 className="text-5xl font-bold tracking-tighter uppercase italic font-serif text-foreground">
              {client.name}
            </h1>
            <p className="text-muted-foreground font-mono text-xs mt-1 uppercase tracking-widest">
              {activeProgram?.name ?? 'No Active Program'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowReport(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-border/50 text-muted-foreground hover:border-primary hover:text-primary transition-colors font-mono text-xs uppercase tracking-widest"
            data-testid="generate-report-btn"
          >
            <FileText className="w-3.5 h-3.5" />
            Report
          </button>

          {/* Notifications permission toggle */}
          {notifPermission !== 'unsupported' && (
            <button
              onClick={() => void requestNotifications()}
              disabled={notifPermission === 'denied'}
              data-testid="notifications-toggle"
              title={
                notifPermission === 'denied'
                  ? 'Re-enable notifications in your browser settings.'
                  : undefined
              }
              className={cn(
                'flex items-center gap-2 px-4 py-2 text-[10px] font-mono uppercase tracking-widest border transition-all',
                notifPermission === 'granted' && 'bg-accent/20 text-accent border-accent',
                notifPermission === 'denied'  && 'border-warning/50 text-warning cursor-not-allowed',
                notifPermission === 'default' && 'border-border text-muted-foreground hover:border-muted-foreground',
              )}
            >
              {notifPermission === 'denied' ? <BellOff className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
              {notifPermission === 'granted'
                ? 'Notifications On'
                : notifPermission === 'denied'
                ? 'Notifications Blocked'
                : 'Enable Notifications'}
            </button>
          )}

          {/* Gym Mode toggle */}
          {wakeLock.isSupported && (
            <button
              onClick={() => void wakeLock.toggle()}
              data-testid="gym-mode-toggle"
              className={cn(
                'flex items-center gap-2 px-4 py-2 text-[10px] font-mono uppercase tracking-widest border transition-all',
                wakeLock.isActive
                  ? 'bg-accent/20 text-accent border-accent'
                  : 'border-border text-muted-foreground hover:border-muted-foreground'
              )}
            >
              <Smartphone className="w-4 h-4" />
              {wakeLock.isActive ? 'Gym Mode On' : 'Gym Mode'}
            </button>
          )}
        </div>
      </header>

      {/* Tab navigation */}
      <div className="flex gap-2 border-b border-border">
        {(['current', 'history', 'analytics'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            data-testid={`dashboard-tab-${t}`}
            className={cn(
              'px-6 py-3 text-[10px] font-mono uppercase tracking-widest transition-all border-b-2 -mb-px',
              tab === t
                ? 'border-foreground text-foreground font-bold'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {t === 'current' ? 'Current Block' : t === 'history' ? `History (${archivedPrograms.length})` : 'Analytics'}
          </button>
        ))}
      </div>

      {/* Tab content — swipeable */}
      <div className="overflow-hidden">
        <motion.div
          className="flex w-full"
          animate={{ x: `-${tabIndex * 100}%` }}
          transition={{ type: 'spring', stiffness: 260, damping: 30 }}
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.15}
          onDragEnd={(_, info) => {
            const threshold = 60;
            if (info.offset.x < -threshold && tabIndex < TABS.length - 1) setTab(TABS[tabIndex + 1]);
            else if (info.offset.x > threshold && tabIndex > 0) setTab(TABS[tabIndex - 1]);
          }}
        >
          <div className="w-full shrink-0 px-1" data-testid="dashboard-panel-current">
            {activeProgram ? (
              <CurrentBlockView
                program={activeProgram}
                selectedWeekId={selectedWeekId}
                onSelectWeek={setSelectedWeekId}
                resumeTarget={resumeTarget}
                onStartWorkout={onStartWorkout}
                onViewHistory={setHistoryDay}
              />
            ) : (
              <NoProgramState onBack={onBack} />
            )}
          </div>
          <div className="w-full shrink-0 px-1" data-testid="dashboard-panel-history">
            <HistoryView archivedPrograms={archivedPrograms} />
          </div>
          <div className="w-full shrink-0 px-1" data-testid="dashboard-panel-analytics">
            <AnalyticsDashboard client={client} />
          </div>
        </motion.div>
      </div>

      {/* Version footer */}
      <div className="text-center text-[10px] font-mono text-muted-foreground/50 uppercase tracking-widest pt-4">
        IronTrack v{__APP_VERSION__}
      </div>

      {historyDay && activeProgram && (
        <WorkoutHistoryModal
          day={historyDay}
          program={activeProgram}
          onClose={() => setHistoryDay(null)}
        />
      )}

      {showReport && (
        <ProgressReport client={client} onClose={() => setShowReport(false)} />
      )}
    </div>
  );
}

// ─── Sub-views ────────────────────────────────────────────────────────────────

function weekStats(week: WorkoutWeek) {
  const total = week.days.length;
  const logged = week.days.filter((d) => !!d.loggedAt).length;
  return { total, logged, complete: total > 0 && logged === total };
}

function CurrentBlockView({
  program,
  selectedWeekId,
  onSelectWeek,
  resumeTarget,
  onStartWorkout,
  onViewHistory,
}: {
  program: Program;
  selectedWeekId: string | undefined;
  onSelectWeek: (id: string) => void;
  resumeTarget: { week: WorkoutWeek; day: WorkoutDay } | null;
  onStartWorkout: (week: WorkoutWeek, day: WorkoutDay) => void;
  onViewHistory: (day: WorkoutDay) => void;
}) {
  const weeks = useMemo(
    () => [...program.weeks].sort((a, b) => a.weekNumber - b.weekNumber),
    [program.weeks],
  );
  const selectedWeek = useMemo(
    () => weeks.find((w) => w.id === selectedWeekId) ?? weeks[0],
    [weeks, selectedWeekId],
  );

  const deloadWarnings = useMemo(() => {
    const result: Record<string, { exerciseName: string; dropPct: number }[]> = {};
    for (const week of program.weeks) {
      const warnings = detectDeloadWeek(program, week.weekNumber);
      if (warnings.length > 0) result[week.id] = warnings;
    }
    return result;
  }, [program]);

  if (!selectedWeek) {
    return (
      <div className="text-center py-12 text-muted-foreground font-mono text-xs uppercase tracking-widest">
        No weeks in this program yet.
      </div>
    );
  }

  return (
    <div className="space-y-5 md:space-y-6">
      {/* ── Smart-resume hero ─────────────────────────────────────────────
           One-tap path to the trainee's NEXT workout. The whole card is a
           button — fingers don't need to find a small "Log Session" link
           on mobile. */}
      {resumeTarget && (
        <motion.button
          type="button"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.99 }}
          onClick={() => onStartWorkout(resumeTarget.week, resumeTarget.day)}
          data-testid="resume-workout-cta"
          className="
            group relative w-full text-left overflow-hidden
            bg-gradient-to-br from-accent/15 via-accent/5 to-card
            border border-accent/30
            shadow-[0_8px_32px_-12px_rgba(0,255,136,0.45)]
            hover:border-accent/50 hover:shadow-[0_8px_40px_-10px_rgba(0,255,136,0.55)]
            transition-[border-color,box-shadow] duration-300
            px-5 md:px-7 py-5 md:py-6
          "
        >
          {/* Decorative corner glow */}
          <div className="absolute -top-12 -right-12 w-40 h-40 bg-accent/20 rounded-full blur-3xl pointer-events-none" />

          <div className="relative flex items-center gap-4 md:gap-5">
            <div className="
              shrink-0 w-12 h-12 md:w-14 md:h-14
              bg-gradient-to-br from-accent to-accent/80
              flex items-center justify-center
              shadow-lg shadow-accent/30
              group-hover:scale-105 transition-transform duration-200
            ">
              <Play className="w-5 h-5 md:w-6 md:h-6 text-white ml-0.5" fill="currentColor" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] md:text-[11px] font-mono uppercase tracking-[0.18em] text-accent/90">
                {resumeTarget.day.loggedAt ? 'Re-log Last Session' : 'Up Next'}
              </div>
              <h2 className="text-xl md:text-2xl font-bold tracking-tight italic font-serif text-foreground truncate mt-0.5">
                {resumeTarget.day.name}
              </h2>
              <div className="text-[11px] md:text-xs font-mono text-muted-foreground mt-0.5">
                Week {resumeTarget.week.weekNumber} · Day {resumeTarget.day.dayNumber}
                {' · '}
                {resumeTarget.day.exercises.length} exercise{resumeTarget.day.exercises.length === 1 ? '' : 's'}
              </div>
            </div>
            <ArrowRight className="shrink-0 w-5 h-5 text-accent/70 group-hover:translate-x-1 group-hover:text-accent transition-colors" />
          </div>
        </motion.button>
      )}

      {/* ── Coach block notes ───────────────────────────────────────────
           Read-only context the coach attached to this block — goal,
           methodology, focus points. Hidden when unset so empty programs
           don't render an empty panel. */}
      {program.coachNotes && (
        <div
          data-testid="coach-block-notes"
          className="border border-primary/20 bg-surface/50 p-4 space-y-1"
        >
          <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-primary/60">
            Coach Notes
          </p>
          <p className="text-sm font-mono text-foreground/80 leading-relaxed whitespace-pre-wrap">
            {program.coachNotes}
          </p>
        </div>
      )}

      {/* ── Horizontal week pills ─────────────────────────────────────────
           Compact, tap-to-select strip. Each pill shows the week number
           plus a small ✓ when fully logged or "n/m" when in progress. */}
      <div>
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
            Week
          </span>
          <span className="text-[10px] font-mono text-muted-foreground">
            {weeks.length} weeks · {weeks.reduce((s, w) => s + w.days.length, 0)} sessions
          </span>
        </div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1 -mx-1 px-1 snap-x snap-mandatory">
          {weeks.map((w) => {
            const stats = weekStats(w);
            const active = w.id === selectedWeek.id;
            return (
              <button
                key={w.id}
                onClick={() => { hapticNav(); onSelectWeek(w.id); }}
                data-testid={`week-tab-${w.weekNumber}`}
                aria-pressed={active}
                className={cn(
                  'snap-start shrink-0 relative px-4 py-3 border transition-all min-w-[72px]',
                  'flex flex-col items-center justify-center gap-0.5',
                  active
                    ? 'bg-foreground text-background border-foreground shadow-lg shadow-black/30'
                    : stats.complete
                      ? 'bg-accent/10 text-accent border-accent/30 hover:bg-accent/15'
                      : stats.logged > 0
                        ? 'bg-card text-foreground border-border/60 hover:border-foreground/30'
                        : 'bg-card/60 text-muted-foreground border-border/40 hover:text-foreground hover:border-border',
                )}
              >
                <span className="text-[9px] font-mono uppercase tracking-widest opacity-70">
                  Wk
                </span>
                <span className="text-xl font-bold font-serif italic tabular-nums leading-none">
                  {w.weekNumber}
                </span>
                <span className={cn(
                  'flex items-center gap-1 text-[9px] font-mono tabular-nums mt-0.5',
                  active ? 'opacity-80' : 'opacity-60',
                )}>
                  {stats.complete ? (
                    <CheckCircle2 className="w-3 h-3" />
                  ) : (
                    <>
                      <span>{stats.logged}</span>
                      <span>/</span>
                      <span>{stats.total}</span>
                    </>
                  )}
                </span>
                {deloadWarnings[w.id] && (
                  <span
                    className="ml-1.5 px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-widest bg-warning/20 text-warning border border-warning/30"
                    title={`Volume drop: ${deloadWarnings[w.id].map(d => `${d.exerciseName} -${d.dropPct}%`).join(', ')}`}
                  >
                    DELOAD
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Day cards for the selected week ───────────────────────────── */}
      <AnimatePresence mode="wait">
        <motion.div
          key={selectedWeek.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18 }}
          className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4"
          data-testid={`week-content-${selectedWeek.weekNumber}`}
        >
          {selectedWeek.days
            .slice()
            .sort((a, b) => a.dayNumber - b.dayNumber)
            .map((day) => {
              const logged = !!day.loggedAt;
              return (
                <button
                  key={day.id}
                  type="button"
                  onClick={() => { hapticNav(); onStartWorkout(selectedWeek, day); }}
                  data-testid={`log-session-btn-day-${day.dayNumber}`}
                  className={cn(
                    'group relative text-left overflow-hidden border transition-all',
                    'px-4 md:px-5 py-4 md:py-5',
                    'hover:-translate-y-0.5',
                    logged
                      ? 'bg-gradient-to-br from-accent/8 to-card border-accent/25 hover:border-accent/40'
                      : 'bg-gradient-to-br from-card via-card to-card/70 border-border/60 hover:border-foreground/30 shadow-[0_6px_24px_-12px_rgba(0,0,0,0.5)]',
                  )}
                >
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[9px] md:text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
                          Day {day.dayNumber}
                        </span>
                        {logged && (
                          <span className="inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-widest text-accent">
                            <CheckCircle2 className="w-3 h-3" />
                            Logged
                          </span>
                        )}
                      </div>
                      <h3 className="text-lg md:text-xl font-bold italic font-serif text-foreground tracking-tight truncate">
                        {day.name}
                      </h3>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {logged && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onViewHistory(day); }}
                          aria-label={`View session log for ${day.name}`}
                          data-testid={`view-history-btn-day-${day.dayNumber}`}
                          className="w-8 h-8 flex items-center justify-center border border-border/50 text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                          title="View session log"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <div className={cn(
                        'w-9 h-9 flex items-center justify-center transition-colors',
                        logged
                          ? 'bg-accent/15 text-accent border border-accent/30'
                          : 'bg-muted/40 text-muted-foreground border border-border/40 group-hover:bg-foreground group-hover:text-background group-hover:border-foreground',
                      )}>
                        {logged ? (
                          <CheckCircle2 className="w-4 h-4" />
                        ) : (
                          <Play className="w-3.5 h-3.5 ml-0.5" fill="currentColor" />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Exercise preview — first 3 exercises so the trainee
                      can confirm "yes, this is the squat day" before tapping. */}
                  {day.exercises.length > 0 && (
                    <ul className="space-y-1 mt-3 pt-3 border-t border-border/30">
                      {day.exercises.slice(0, 3).map((ex) => (
                        <li
                          key={ex.id}
                          className="flex items-center justify-between gap-3 text-[11px] md:text-xs"
                        >
                          <span className="flex items-center gap-2 min-w-0 text-foreground/80">
                            <Circle className="w-1.5 h-1.5 fill-current shrink-0 opacity-50" />
                            <span className="truncate font-medium">{ex.exerciseName}</span>
                            {ex.videoUrl && (
                              // Pre-workout technique reference. The day-card
                              // wraps this in a <button>, so we stop
                              // propagation to keep clicking the icon from
                              // also firing onStartWorkout.
                              <a
                                href={ex.videoUrl}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                aria-label={`Watch technique video for ${ex.exerciseName}`}
                                data-testid={`exercise-video-${ex.id}`}
                                title="Watch technique video"
                                className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-sm border border-primary/30 text-primary hover:bg-primary/15 hover:border-primary hover:text-primary/80 transition-colors"
                              >
                                <Video className="w-3 h-3" />
                              </a>
                            )}
                          </span>
                          <span className="shrink-0 text-[10px] font-mono text-muted-foreground/80">
                            {ex.sets ?? '?'}×{ex.reps ?? '?'}
                          </span>
                        </li>
                      ))}
                      {day.exercises.length > 3 && (
                        <li className="text-[10px] font-mono text-muted-foreground/60 pl-4">
                          + {day.exercises.length - 3} more
                        </li>
                      )}
                    </ul>
                  )}
                </button>
              );
            })}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function HistoryView({ archivedPrograms }: { archivedPrograms: Program[] }) {
  if (archivedPrograms.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="flex flex-col items-center justify-center py-20 text-center"
        data-testid="history-empty"
      >
        <Archive className="w-12 h-12 text-muted-foreground mb-4" />
        <h3 className="text-xl font-bold italic font-serif">No Archived Blocks Yet</h3>
        <p className="text-muted-foreground font-mono text-xs mt-2 uppercase tracking-widest">
          Completed cycles will appear here
        </p>
      </motion.div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6" data-testid="history-grid">
      {archivedPrograms.map((p) => {
        const totalDays = p.weeks.reduce((s, w) => s + w.days.length, 0);
        const loggedDays = p.weeks.reduce(
          (s, w) => s + w.days.filter((d) => d.loggedAt).length,
          0
        );
        return (
          <TechnicalCard key={p.id}>
            <div className="p-6 space-y-4" data-testid={`history-card-${p.id}`}>
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest">
                    Archived Block
                  </p>
                  <h3 className="text-2xl font-bold italic font-serif tracking-tight">{p.name}</h3>
                </div>
                <Archive className="w-5 h-5 text-muted-foreground" />
              </div>
              <div className="grid grid-cols-3 gap-4 pt-4 border-t border-border">
                <Stat label="Weeks" value={String(p.weeks.length)} />
                <Stat label="Sessions" value={`${loggedDays}/${totalDays}`} />
                <Stat
                  label="Archived"
                  value={p.archivedAt ? new Date(p.archivedAt).toLocaleDateString() : '—'}
                />
              </div>
            </div>
          </TechnicalCard>
        );
      })}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] text-muted-foreground font-mono uppercase tracking-widest">{label}</p>
      <p className="text-sm font-bold font-mono text-foreground mt-1">{value}</p>
    </div>
  );
}

function NoProgramState({ onBack }: { onBack?: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="flex flex-col items-center justify-center py-20 text-center"
    >
      <AlertCircle className="w-12 h-12 text-muted-foreground mb-4" />
      <h2 className="text-2xl font-bold italic font-serif">No Program Assigned</h2>
      <p className="text-muted-foreground font-mono text-sm mt-2">
        Contact your coach to assign a training block.
      </p>
      {onBack && (
        <button
          onClick={onBack}
          className="mt-8 text-xs font-bold uppercase tracking-widest underline"
        >
          Back
        </button>
      )}
    </motion.div>
  );
}