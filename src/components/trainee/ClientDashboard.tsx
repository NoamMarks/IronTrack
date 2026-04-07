import { useState } from 'react';
import { ArrowLeft, AlertCircle, Smartphone, Archive, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { TechnicalCard } from '../ui';
import { cn } from '../../lib/utils';
import { useWakeLock } from '../../hooks/useWakeLock';
import { AnalyticsDashboard } from './AnalyticsDashboard';
import type { Client, Program, WorkoutWeek, WorkoutDay } from '../../types';

interface ClientDashboardProps {
  client: Client;
  onBack: () => void;
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
  const [expandedWeekId, setExpandedWeekId] = useState<string | undefined>(activeProgram?.weeks[0]?.id);
  const toggleWeek = (id: string) =>
    setExpandedWeekId((current) => (current === id ? undefined : id));

  const wakeLock = useWakeLock();

  return (
    <div className="space-y-10">
      {/* Header */}
      <header className="flex justify-between items-end">
        <div className="flex items-center space-x-8">
          <motion.button whileHover={{ x: -4 }} onClick={onBack} className="p-3 hover:bg-muted transition-colors rounded-sm">
            <ArrowLeft className="w-8 h-8 text-foreground" />
          </motion.button>
          <div>
            <h1 className="text-5xl font-bold tracking-tighter uppercase italic font-serif text-foreground">
              {client.name}
            </h1>
            <p className="text-muted-foreground font-mono text-xs mt-1 uppercase tracking-widest">
              {activeProgram?.name ?? 'No Active Program'}
            </p>
          </div>
        </div>
        {/* Gym Mode toggle */}
        {wakeLock.isSupported && (
          <button
            onClick={() => void wakeLock.toggle()}
            data-testid="gym-mode-toggle"
            className={cn(
              'flex items-center gap-2 px-4 py-2 text-[10px] font-mono uppercase tracking-widest border transition-all',
              wakeLock.isActive
                ? 'bg-green-600 text-white border-green-600'
                : 'border-border text-muted-foreground hover:border-muted-foreground'
            )}
          >
            <Smartphone className="w-4 h-4" />
            {wakeLock.isActive ? 'Gym Mode On' : 'Gym Mode'}
          </button>
        )}
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
                expandedWeekId={expandedWeekId}
                onToggleWeek={toggleWeek}
                onStartWorkout={onStartWorkout}
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
    </div>
  );
}

// ─── Sub-views ────────────────────────────────────────────────────────────────

function CurrentBlockView({
  program,
  expandedWeekId,
  onToggleWeek,
  onStartWorkout,
}: {
  program: Program;
  expandedWeekId: string | undefined;
  onToggleWeek: (id: string) => void;
  onStartWorkout: (week: WorkoutWeek, day: WorkoutDay) => void;
}) {
  return (
    <div className="space-y-4">
      {program.weeks.map((week) => {
        const isOpen = expandedWeekId === week.id;
        return (
          <TechnicalCard key={week.id} className="overflow-hidden">
            <button
              type="button"
              onClick={() => onToggleWeek(week.id)}
              data-testid={`week-tab-${week.weekNumber}`}
              aria-expanded={isOpen}
              className={cn(
                'w-full flex justify-between items-center px-6 py-5 text-left transition-colors',
                isOpen ? 'bg-muted/40' : 'hover:bg-muted/20'
              )}
            >
              <div className="flex items-center gap-4">
                <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
                  Week
                </span>
                <span className="text-2xl font-bold italic font-serif tracking-tight">
                  {week.weekNumber}
                </span>
                <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
                  {week.days.length} {week.days.length === 1 ? 'day' : 'days'}
                </span>
              </div>
              <motion.div animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
                <ChevronDown className="w-5 h-5 text-muted-foreground" />
              </motion.div>
            </button>

            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  key="content"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: 'easeInOut' }}
                  className="overflow-hidden"
                  data-testid={`week-content-${week.weekNumber}`}
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 border-t border-border">
                    {week.days.map((day) => (
                      <div key={day.id} className="border border-border p-6 space-y-5 bg-card">
                        <div className="flex justify-between items-center">
                          <div>
                            <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest">
                              Day {day.dayNumber}
                            </p>
                            <h3 className="text-2xl font-bold text-foreground italic font-serif tracking-tight">
                              {day.name}
                            </h3>
                          </div>
                          <button
                            onClick={() => onStartWorkout(week, day)}
                            data-testid={`log-session-btn-day-${day.dayNumber}`}
                            className="border-2 border-foreground text-foreground px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest hover:bg-foreground hover:text-background transition-all shadow-sm"
                          >
                            Log Session
                          </button>
                        </div>

                        <div className="space-y-3">
                          {day.exercises.map((ex, i) => (
                            <div
                              key={ex.id}
                              className="flex justify-between items-center text-xs font-mono py-2 border-b border-border last:border-0 group"
                            >
                              <div className="flex items-center">
                                <span className="text-muted-foreground/40 mr-4 group-hover:text-foreground transition-colors">
                                  {String(i + 1).padStart(2, '0')}
                                </span>
                                <span className="text-foreground font-medium">{ex.exerciseName}</span>
                              </div>
                              <span className="text-muted-foreground bg-muted/30 px-2 py-1 rounded-sm font-mono">
                                {ex.sets} × {ex.reps}
                                {ex.expectedRpe ? ` @${ex.expectedRpe}` : ''}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </TechnicalCard>
        );
      })}
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

function NoProgramState({ onBack }: { onBack: () => void }) {
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
      <button
        onClick={onBack}
        className="mt-8 text-xs font-bold uppercase tracking-widest underline"
      >
        Back
      </button>
    </motion.div>
  );
}