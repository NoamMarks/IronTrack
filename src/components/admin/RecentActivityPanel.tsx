import { useMemo } from 'react';
import { Activity, MessageSquare, Radio } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useRecentActivity } from '../../hooks/useRecentActivity';
import { cn } from '../../lib/utils';

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
 * The empty state is intentionally explanatory: a coach who's never
 * received a reflection should immediately understand what's supposed to
 * appear here and why it's blank.
 */
export function RecentActivityPanel({ tenantId, className }: RecentActivityPanelProps) {
  const { entries, isInitialLoad } = useRecentActivity(tenantId);

  return (
    <aside
      data-testid="recent-activity-panel"
      className={cn('flex flex-col bg-card border border-border rounded-card overflow-hidden', className)}
    >
      <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-foreground" />
          <h2 className="text-[11px] font-mono font-bold uppercase tracking-widest text-foreground">
            Recent Activity
          </h2>
        </div>
        <div className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-widest text-emerald-400">
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
            {entries.map((entry) => (
              <motion.li
                key={entry.dayId}
                layout
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.22 }}
                data-testid={`activity-entry-${entry.dayId}`}
                className="px-4 py-3 hover:bg-muted/20 transition-colors"
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
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </aside>
  );
}

function DifficultyPill({ difficulty }: { difficulty: number | null }) {
  const tone = useMemo(() => {
    if (difficulty == null) return null;
    if (difficulty <= 2) return { color: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10', label: 'Easy' };
    if (difficulty === 3) return { color: 'text-sky-400 border-sky-500/30 bg-sky-500/10', label: 'Solid' };
    if (difficulty === 4) return { color: 'text-amber-400 border-amber-500/30 bg-amber-500/10', label: 'Brutal' };
    return { color: 'text-red-400 border-red-500/30 bg-red-500/10', label: 'Maxed' };
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
      <Activity className="w-8 h-8 text-muted-foreground mb-3" />
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
