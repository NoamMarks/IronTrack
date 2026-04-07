import React, { useState, useRef } from 'react';
import { ArrowLeft, Save, Circle, Upload, Play, Calculator } from 'lucide-react';
import { TechnicalCard, TechnicalInput, RPEBadge } from '../ui';
import { cn } from '../../lib/utils';
import { DEFAULT_COLUMNS } from '../../constants/mockData';
import { PlateCalculator } from './PlateCalculator';
import { hapticTick, hapticSuccess } from '../../lib/haptics';
import type { Client, Program, WorkoutWeek, WorkoutDay, ExercisePlan } from '../../types';

// ─── Helper ─────────────────────────────────────────────────────────────────

function getExerciseValue(ex: ExercisePlan, colId: string): string | number | undefined {
  if (colId === 'sets')        return ex.sets;
  if (colId === 'reps')        return ex.reps;
  if (colId === 'expectedRpe') return ex.expectedRpe;
  if (colId === 'weightRange') return ex.weightRange;
  if (colId === 'actualLoad')  return ex.actualLoad;
  if (colId === 'actualRpe')   return ex.actualRpe;
  if (colId === 'notes')       return ex.notes;
  return ex.values?.[colId] ?? '';
}

// ─── Session ID for status bar ───────────────────────────────────────────────

const SESSION_ID = Math.random().toString(36).substring(7).toUpperCase();

// ─── Props ───────────────────────────────────────────────────────────────────

interface WorkoutGridLoggerProps {
  client: Client;
  program: Program;
  week: WorkoutWeek;
  day: WorkoutDay;
  onBack: () => void;
  onSave: (updatedDay: WorkoutDay) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function WorkoutGridLogger({
  client,
  program,
  week,
  day,
  onBack,
  onSave,
}: WorkoutGridLoggerProps) {
  const [exercises, setExercises] = useState<ExercisePlan[]>(day.exercises);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [plateCalcOpen, setPlateCalcOpen] = useState(false);
  const [plateCalcWeight, setPlateCalcWeight] = useState('');
  const [plateCalcExerciseId, setPlateCalcExerciseId] = useState<string | null>(null);

  const columns = program.columns ?? DEFAULT_COLUMNS;

  const updateExercise = (id: string, field: string, value: string) => {
    // Gentle haptic tick only when the user logs an actual (not plan edits, not empty clears)
    if (['actualLoad', 'actualRpe'].includes(field) && value.trim() !== '') {
      hapticTick();
    }
    setExercises((prev) =>
      prev.map((ex) => {
        if (ex.id !== id) return ex;
        if (['actualLoad', 'actualRpe', 'notes', 'videoUrl'].includes(field)) {
          return { ...ex, [field]: value };
        }
        return { ...ex, values: { ...(ex.values ?? {}), [field]: value } };
      })
    );
  };

  const handleSave = () => {
    hapticSuccess();
    onSave({ ...day, exercises });
  };

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0] && uploadingFor) {
      const url = URL.createObjectURL(e.target.files[0]);
      updateExercise(uploadingFor, 'videoUrl', url);
      setUploadingFor(null);
    }
  };

  const gridTemplate = `40px 2fr ${columns.map(() => '1fr').join(' ')} 1fr`;

  return (
    <div className="space-y-8 h-full flex flex-col">
      {/* Header */}
      <header className="flex justify-between items-end">
        <div className="flex items-center space-x-6">
          <button onClick={onBack} className="p-2 hover:bg-muted transition-colors">
            <ArrowLeft className="w-6 h-6 text-foreground" />
          </button>
          <div>
            <h1 className="text-4xl font-bold tracking-tighter uppercase italic font-serif text-foreground">
              Log Session
            </h1>
            <p className="text-muted-foreground font-mono text-xs mt-1 uppercase tracking-widest">
              {client.name} / Week {week.weekNumber} / {day.name}
            </p>
          </div>
        </div>
        <div className="flex items-end gap-4">
          <button
            onClick={handleSave}
            data-testid="save-session-btn"
            className="bg-green-600 text-white px-8 py-4 text-xs font-bold uppercase tracking-widest flex items-center hover:bg-green-500 transition-all shadow-lg hover:shadow-green-500/20"
          >
            <Save className="w-4 h-4 mr-2" />
            Save Session
          </button>
        </div>
      </header>

      {/* Grid */}
      <TechnicalCard className="flex-grow overflow-auto border-2">
        <div className="min-w-[1200px]">
          {/* Header row */}
          <div
            className="grid border-b border-border bg-muted/80 backdrop-blur-md sticky top-0 z-10"
            style={{ gridTemplateColumns: gridTemplate }}
          >
            <div className="p-4 text-[10px] text-muted-foreground font-mono uppercase border-r border-border">
              #
            </div>
            <div className="p-4 text-[10px] text-muted-foreground font-mono uppercase border-r border-border">
              Exercise
            </div>
            {columns.map((col) => (
              <div
                key={col.id}
                className={cn(
                  'p-4 text-[10px] font-mono uppercase border-r border-border text-center',
                  col.type === 'actual' ? 'text-foreground bg-muted/50' : 'text-muted-foreground'
                )}
              >
                {col.label}
              </div>
            ))}
            <div className="p-4 text-[10px] text-muted-foreground font-mono uppercase">Video</div>
          </div>

          {/* Exercise rows */}
          {exercises.map((ex, idx) => (
            <div
              key={ex.id}
              className="grid border-b border-border hover:bg-muted/30 transition-colors group"
              style={{ gridTemplateColumns: gridTemplate }}
              data-testid={`exercise-row-${idx}`}
            >
              <div className="p-4 text-xs text-muted-foreground font-mono border-r border-border flex items-center justify-center">
                {String(idx + 1).padStart(2, '0')}
              </div>
              <div className="p-4 text-xs text-foreground font-bold border-r border-border flex items-center">
                {ex.exerciseName}
              </div>

              {columns.map((col) => (
                <div
                  key={col.id}
                  className={cn(
                    'p-4 border-r border-border flex items-center justify-center',
                    col.type === 'actual' ? 'bg-muted/10 group-hover:bg-muted/20 transition-colors' : ''
                  )}
                >
                  {col.type === 'plan' ? (
                    col.id === 'expectedRpe' ? (
                      <RPEBadge value={getExerciseValue(ex, col.id) as string | number | undefined} />
                    ) : (
                      <span className="text-xs text-muted-foreground font-mono">
                        {String(getExerciseValue(ex, col.id) ?? '-') || '-'}
                      </span>
                    )
                  ) : (
                    <div className="flex items-center gap-1 w-full">
                      <TechnicalInput
                        value={String(getExerciseValue(ex, col.id) ?? '')}
                        onChange={(val) => updateExercise(ex.id, col.id, val)}
                        placeholder=""
                        className="text-center"
                        data-testid={`input-${ex.id}-${col.id}`}
                      />
                      {col.id === 'actualLoad' && (
                        <button
                          onClick={() => {
                            setPlateCalcWeight(String(getExerciseValue(ex, 'actualLoad') ?? ''));
                            setPlateCalcExerciseId(ex.id);
                            setPlateCalcOpen(true);
                          }}
                          className="shrink-0 w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                          title="Plate calculator"
                          data-testid={`plate-calc-btn-${ex.id}`}
                        >
                          <Calculator className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {/* Video */}
              <div className="p-4 flex items-center justify-center">
                {ex.videoUrl ? (
                  <a
                    href={ex.videoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="w-8 h-8 bg-blue-500/10 text-blue-500 rounded-full flex items-center justify-center hover:bg-blue-500 hover:text-white transition-all"
                  >
                    <Play className="w-4 h-4" />
                  </a>
                ) : (
                  <button
                    onClick={() => { setUploadingFor(ex.id); fileInputRef.current?.click(); }}
                    className="w-8 h-8 bg-muted text-muted-foreground rounded-full flex items-center justify-center hover:bg-foreground hover:text-background transition-all"
                  >
                    <Upload className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </TechnicalCard>

      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept="video/*"
        onChange={handleVideoUpload}
      />

      {/* Status bar */}
      <div className="bg-card border border-border p-4 font-mono text-[10px] text-muted-foreground uppercase tracking-widest flex justify-between">
        <div className="flex items-center space-x-4">
          <span className="flex items-center">
            <Circle className="w-2 h-2 fill-green-500 text-green-500 mr-2" />
            System Status: Operational
          </span>
          <span>Buffer: Local Storage</span>
        </div>
        <span>Session ID: {SESSION_ID}</span>
      </div>

      <PlateCalculator
        isOpen={plateCalcOpen}
        onClose={() => {
          setPlateCalcOpen(false);
          setPlateCalcExerciseId(null);
        }}
        initialWeight={plateCalcWeight}
        onApply={(weight) => {
          if (plateCalcExerciseId) {
            updateExercise(plateCalcExerciseId, 'actualLoad', weight);
          }
          setPlateCalcOpen(false);
          setPlateCalcExerciseId(null);
        }}
      />
    </div>
  );
}
