import { useState } from 'react';
import { ArrowLeft, AlertCircle, Smartphone } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { TechnicalCard } from '../ui';
import { cn } from '../../lib/utils';
import { useWakeLock } from '../../hooks/useWakeLock';
import type { Client, WorkoutWeek, WorkoutDay } from '../../types';

interface ClientDashboardProps {
  client: Client;
  onBack: () => void;
  onStartWorkout: (week: WorkoutWeek, day: WorkoutDay) => void;
}

export function ClientDashboard({ client, onBack, onStartWorkout }: ClientDashboardProps) {
  const activeProgram =
    client.programs.find((p) => p.id === client.activeProgramId) ?? client.programs[0];

  const [selectedWeekId, setSelectedWeekId] = useState(activeProgram?.weeks[0]?.id);
  const selectedWeek = activeProgram?.weeks.find((w) => w.id === selectedWeekId) ?? activeProgram?.weeks[0];

  const wakeLock = useWakeLock();

  if (!activeProgram) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
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
      </div>
    );
  }

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
              {activeProgram.name}
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

      {/* Week selector */}
      <div className="flex space-x-4 border-b border-border pb-6 overflow-x-auto no-scrollbar">
        {activeProgram.weeks.map((week) => (
          <button
            key={week.id}
            onClick={() => setSelectedWeekId(week.id)}
            data-testid={`week-tab-${week.weekNumber}`}
            className={cn(
              'px-6 py-3 text-xs font-mono uppercase tracking-widest transition-all whitespace-nowrap border',
              selectedWeek?.id === week.id
                ? 'bg-foreground text-background font-bold border-foreground shadow-lg'
                : 'text-muted-foreground hover:text-foreground border-transparent hover:border-border'
            )}
          >
            Week {week.weekNumber}
          </button>
        ))}
      </div>

      {/* Day cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <AnimatePresence mode="popLayout">
          {selectedWeek?.days.map((day, idx) => (
            <motion.div
              key={day.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
            >
              <TechnicalCard className="hover:shadow-lg transition-shadow">
                <div className="p-8">
                  <div className="flex justify-between items-center mb-8">
                    <div>
                      <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest">
                        Day {day.dayNumber}
                      </p>
                      <h3 className="text-3xl font-bold text-foreground italic font-serif tracking-tight">
                        {day.name}
                      </h3>
                    </div>
                    <button
                      onClick={() => onStartWorkout(selectedWeek, day)}
                      data-testid={`log-session-btn-day-${day.dayNumber}`}
                      className="border-2 border-foreground text-foreground px-6 py-3 text-[10px] font-bold uppercase tracking-widest hover:bg-foreground hover:text-background transition-all shadow-sm"
                    >
                      Log Session
                    </button>
                  </div>

                  <div className="space-y-4">
                    {day.exercises.map((ex, i) => (
                      <div
                        key={ex.id}
                        className="flex justify-between items-center text-xs font-mono py-3 border-b border-border last:border-0 group"
                      >
                        <div className="flex items-center">
                          <span className="text-muted-foreground/40 mr-4 group-hover:text-foreground transition-colors">
                            {String(i + 1).padStart(2, '0')}
                          </span>
                          <span className="text-foreground font-medium">{ex.exerciseName}</span>
                        </div>
                        <span className="text-muted-foreground bg-muted/30 px-2 py-1 rounded-sm">
                          {ex.sets} × {ex.reps}{ex.expectedRpe ? ` @${ex.expectedRpe}` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </TechnicalCard>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Version footer */}
      <div className="text-center text-[10px] font-mono text-muted-foreground/50 uppercase tracking-widest pt-4">
        IronTrack v{__APP_VERSION__}
      </div>
    </div>
  );
}
