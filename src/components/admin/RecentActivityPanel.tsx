import { useMemo, useState, useCallback } from 'react';
import { Activity, MessageSquare, Radio, Pencil, X, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from '../../lib/supabase';
import { useRecentActivity, type ActivityEntry } from '../../hooks/useRecentActivity';
import { Button } from '../ui';
import { cn } from '../../lib/utils';

const MAX_COACH_NOTE = 300;

interface RecentActivityPanelProps {
  tenantId: string | null | undefined;
  /** Optional className applied to the outer panel — used by AdminView to
   *  toggle visibility on smaller breakpoints. */
  className?: string;
}

/**
 * Coach-side sidebar showing the latest 20 post-workout reflections from
 * trainees in the current tenant. Backed by a Supabase realtime channel —
 * a fresh reflection submitted by a trainee animates into the list within
 * a second or so without a manual refresh.
 *
 * Coaches can type a short feedback note directly on each entry; the note
 * is persisted to `days.coach_note` and displayed read-only in the
 * trainee's Workout History modal.
 */
export function RecentActivityPanel({ tenantId, className }: RecentActivityPanelProps) {
  const { entries, isInitialLoad } = useRecentActivity(tenantId);

  // dayId → true when the feedback textarea is expanded for that entry.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // dayId → current draft text while the textarea is open.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // dayId → true while a save is in flight.
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  const openFeedback = useCallback((entry: ActivityEntry) => {
    setDrafts((d) => ({ ...d, [entry.dayId]: entry.coachNote ?? '' }));
    setExpanded((e) => ({ ...e, [entry.dayId]: true }));
  }, []);

  const cancelFeedback = useCallback((dayId: string) => {
    setExpanded((e) => ({ ...e, [dayId]: false }));
  }, []);

  const saveFeedback = useCallback(async (dayId: string, note: string) => {
    setSaving((s) => ({ ...s, [dayId]: true }));
    try {
      const trimmed = note.trim();
      const { error } = await supabase
        .from('days')
        .update({ coach_note: trimmed || null })
        .eq('id', dayId);
      if (error) throw error;
      setExpanded((e) => ({ ...e, [dayId]: false }));
    } catch (err) {
      console.error('[IronTrack] saveCoachNote failed', err);
    } finally {
      setSaving((s) => ({ ...s, [dayId]: false }));
    }
  }, []);

  return (
    <aside
      data-testid="recent-activity-panel"
      className={cn('flex flex-col bg-card border border-border border-t-2 border-t-primary/40 overflow-hidden', className)}
    >
      <header className="flex items-center justify-between px-4 py-3 border-b border-primary/20 bg-surface/60">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-foreground" />
          <h2 className="text-[11px] font-mono font-bold uppercase tracking-widest text-foreground">
            Recent Activity
          </h2>
        </div>
        <div className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-widest text-accent">
          <Radio className="w-3 h-3 animate-pulse" />
          Live
        </div>
      </header>

      {isInitialLoad ? (
        <LoadingState />
      ) : entries.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="flex-1 overflow-y-auto divide-y divide-border" data-testid="activity-feed">
          <AnimatePresence initial={false}>
            {entries.map((entry) => {
              const isExpanded = !!expanded[entry.dayId];
              const draft = drafts[entry.dayId] ?? '';
              const isSaving = !!saving[entry.dayId];

              return (
                <motion.li
                  key={entry.dayId}
                  layout
                  initial={{ opacity: 0, x: 24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -24 }}
                  transition={{ duration: 0.3, ease: 'easeOut' }}
                  data-testid={`activity-entry-${entry.dayId}`}
                  className="px-4 py-3 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-foreground truncate">
                        {entry.traineeName}
                      </p>
                      <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest truncate">
                        {entry.dayName}
                      </p>
                    </div>
                    <DifficultyPill difficulty={entry.difficulty} />
                  </div>

                  {entry.note && (
                    <p className="text-[11px] text-foreground/85 leading-relaxed mt-1.5 flex gap-1.5">
                      <MessageSquare className="w-3 h-3 mt-0.5 text-muted-foreground shrink-0" />
                      <span className="break-words">{entry.note}</span>
                    </p>
                  )}

                  <p className="text-[9px] font-mono text-muted-foreground/60 uppercase tracking-widest mt-2">
                    {formatRelativeTime(entry.reflectionAt)}
                  </p>

                  {/* Coach feedback — saved note or expand button */}
                  {!isExpanded && (
                    <div className="mt-2">
                      {entry.coachNote ? (
                        <div className="flex items-start gap-1.5 border-l-2 border-primary/40 pl-2">
                          <p className="text-[10px] font-mono text-primary/70 leading-relaxed flex-1 break-words">
                            {entry.coachNote}
                          </p>
                          <button
                            type="button"
                            onClick={() => openFeedback(entry)}
                            aria-label="Edit feedback"
                            data-testid={`edit-feedback-btn-${entry.dayId}`}
                            className="shrink-0 text-muted-foreground hover:text-primary transition-colors"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openFeedback(entry)}
                          aria-label="Add feedback"
                          data-testid={`add-feedback-btn-${entry.dayId}`}
                          className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors"
                        >
                          <MessageSquare className="w-3 h-3" />
                          Add feedback
                        </button>
                      )}
                    </div>
                  )}

                  {/* Inline textarea when expanded */}
                  <AnimatePresence initial={false}>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.18 }}
                        className="overflow-hidden mt-2"
                      >
                        <textarea
                          value={draft}
                          onChange={(e) =>
                            setDrafts((d) => ({
                              ...d,
                              [entry.dayId]: e.target.value.slice(0, MAX_COACH_NOTE),
                            }))
                          }
                          rows={2}
                          maxLength={MAX_COACH_NOTE}
                          placeholder="Short feedback for the trainee…"
                          data-testid={`feedback-textarea-${entry.dayId}`}
                          className="w-full bg-surface border-b border-primary/30 focus:border-primary text-[11px] font-mono text-foreground px-2 py-1.5 outline-none resize-none placeholder:text-muted-foreground/60"
                        />
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-[9px] font-mono text-muted-foreground/60 tabular-nums">
                            {draft.length}/{MAX_COACH_NOTE}
                          </span>
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => cancelFeedback(entry.dayId)}
                              aria-label="Cancel"
                              data-testid={`cancel-feedback-btn-${entry.dayId}`}
                              className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                            <Button
                              variant="primary"
                              size="sm"
                              type="button"
                              onClick={() => void saveFeedback(entry.dayId, draft)}
                              disabled={isSaving}
                              aria-label="Save feedback"
                              data-testid={`save-feedback-btn-${entry.dayId}`}
                            >
                              <Check className="w-3 h-3" />
                              {isSaving ? 'Saving' : 'Save'}
                            </Button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </aside>
  );
}

function DifficultyPill({ difficulty }: { difficulty: number | null }) {
  const tone = useMemo(() => {
    if (difficulty == null) return null;
    if (difficulty <= 2) return { color: 'text-accent border-accent/30 bg-accent/10', label: 'Easy' };
    if (difficulty === 3) return { color: 'text-primary border-primary/30 bg-primary/10', label: 'Solid' };
    if (difficulty === 4) return { color: 'text-warning border-warning/30 bg-warning/10', label: 'Brutal' };
    return { color: 'text-danger border-danger/30 bg-danger/10', label: 'Maxed' };
  }, [difficulty]);

  if (!tone || difficulty == null) return null;
  return (
    <span
      className={cn(
        'shrink-0 inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-widest border rounded-sm',
        tone.color,
      )}
    >
      <span className="tabular-nums">{difficulty}</span>
      <span className="opacity-80">{tone.label}</span>
    </span>
  );
}

function LoadingState() {
  return (
    <div className="flex-1 flex items-center justify-center py-12 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
      Loading…
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="w-12 h-12 border border-border/50 flex items-center justify-center mb-3">
        <Activity className="w-5 h-5 text-muted-foreground" />
      </div>
      <p className="text-xs font-mono text-foreground uppercase tracking-widest">
        No reflections yet
      </p>
      <p className="text-[10px] font-mono text-muted-foreground/70 mt-2 leading-relaxed">
        Trainee notes from the post-workout modal land here in real time.
      </p>
    </div>
  );
}

/**
 * Cheap "x ago" formatter — coarser than full date-fns formatDistanceToNow
 * but covers the only granularities we surface (just-now / minutes / hours
 * / days). For anything older than a week we fall back to the absolute
 * date so old activity reads sensibly without saying "23 days ago".
 */
function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return iso;
  const diffMs = Date.now() - then;
  const diffSec = Math.max(0, Math.floor(diffMs / 1000));
  if (diffSec < 30) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString();
}
