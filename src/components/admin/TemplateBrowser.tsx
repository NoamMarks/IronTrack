import { useMemo, useState } from 'react';
import { Eye, Trash2, Search, FileText, ChevronRight, Library } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { TechnicalCard } from '../ui';
import { cn } from '../../lib/utils';
import type { ProgramTemplate } from '../../hooks/useTemplates';

interface TemplateBrowserProps {
  templates: ProgramTemplate[];
  isLoading?: boolean;
  /** When provided, each row exposes a "Load" action — used inside the
   *  AdminView "Load from Template" modal. Omit for a read-only/manage
   *  surface. */
  onLoad?: (template: ProgramTemplate) => void | Promise<void>;
  onDelete?: (template: ProgramTemplate) => void | Promise<void>;
  /** Optional className for the outer container — lets callers control
   *  height (e.g. constrained inside a modal vs. sticky in a sidebar). */
  className?: string;
  /** Hide the search box — useful when the list is short or when the
   *  parent provides its own filter. */
  hideSearch?: boolean;
}

/**
 * The coach's template library, rendered as a brutalist list with Preview
 * and Delete actions on every row plus an optional Load action. Preview
 * expands an inline tree summary (week count, day count, exercise list)
 * so the coach can verify a template before instantiating it without
 * leaving the modal.
 *
 * Delete prompts via window.confirm — matches the archive flow elsewhere
 * in the admin UI and avoids introducing a second bespoke confirm dialog.
 */
export function TemplateBrowser({
  templates,
  isLoading = false,
  onLoad,
  onDelete,
  className,
  hideSearch = false,
}: TemplateBrowserProps) {
  const [query, setQuery] = useState('');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((t) =>
      t.name.toLowerCase().includes(q)
      || (t.description ?? '').toLowerCase().includes(q),
    );
  }, [templates, query]);

  const togglePreview = (id: string) => {
    setPreviewId((prev) => (prev === id ? null : id));
  };

  const handleDelete = async (template: ProgramTemplate) => {
    if (!onDelete) return;
    if (!window.confirm(`Delete template "${template.name}"? This cannot be undone.`)) return;
    setBusyId(template.id);
    try {
      await onDelete(template);
    } finally {
      setBusyId(null);
    }
  };

  const handleLoad = async (template: ProgramTemplate) => {
    if (!onLoad) return;
    setBusyId(template.id);
    try {
      await onLoad(template);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div data-testid="template-browser" className={cn('flex flex-col gap-4', className)}>
      {!hideSearch && (
        <div className="flex items-center gap-2 bg-muted/30 border border-border px-3 py-2">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search templates..."
            data-testid="template-search"
            className="bg-transparent border-none outline-none focus:ring-0 text-sm font-mono text-foreground w-full placeholder:text-muted-foreground/60"
          />
          {query && (
            <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
              {filtered.length}/{templates.length}
            </span>
          )}
        </div>
      )}

      {isLoading ? (
        <LoadingState />
      ) : templates.length === 0 ? (
        <EmptyState />
      ) : filtered.length === 0 ? (
        <NoMatches query={query} />
      ) : (
        <ul className="space-y-3" data-testid="template-list">
          <AnimatePresence initial={false}>
            {filtered.map((template) => {
              const expanded = previewId === template.id;
              const busy = busyId === template.id;
              return (
                <motion.li
                  key={template.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.18 }}
                  data-testid={`template-row-${template.id}`}
                >
                  <TechnicalCard className="overflow-hidden hover:border-muted-foreground transition-colors">
                    <div className="px-5 py-4 flex items-start gap-4">
                      <div className="w-10 h-10 bg-muted flex items-center justify-center shrink-0">
                        <FileText className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-base font-bold italic font-serif tracking-tight text-foreground truncate">
                          {template.name}
                        </h3>
                        {template.description && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                            {template.description}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[9px] font-mono text-muted-foreground/80 uppercase tracking-widest">
                          <span>{template.weeks.length} {template.weeks.length === 1 ? 'week' : 'weeks'}</span>
                          <span>{countDays(template)} {countDays(template) === 1 ? 'day' : 'days'}</span>
                          <span>{countExercises(template)} ex.</span>
                          <span>{formatDate(template.createdAt)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Action row — Preview is always present; Load and Delete
                        depend on the props the caller wired in. */}
                    <div className="flex flex-wrap gap-px bg-border" data-testid={`template-actions-${template.id}`}>
                      <button
                        type="button"
                        onClick={() => togglePreview(template.id)}
                        data-testid={`template-preview-btn-${template.id}`}
                        className="flex-1 px-3 py-2.5 bg-card hover:bg-muted/40 text-[10px] font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center gap-1.5"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        {expanded ? 'Hide' : 'Preview'}
                      </button>
                      {onLoad && (
                        <button
                          type="button"
                          onClick={() => void handleLoad(template)}
                          disabled={busy}
                          data-testid={`template-load-btn-${template.id}`}
                          className="flex-[2] px-3 py-2.5 bg-foreground text-background hover:opacity-90 text-[10px] font-mono font-bold uppercase tracking-widest transition-opacity disabled:opacity-40 disabled:cursor-wait flex items-center justify-center gap-1.5"
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                          {busy ? 'Loading...' : 'Load'}
                        </button>
                      )}
                      {onDelete && (
                        <button
                          type="button"
                          onClick={() => void handleDelete(template)}
                          disabled={busy}
                          data-testid={`template-delete-btn-${template.id}`}
                          className="px-3 py-2.5 bg-card hover:bg-red-500/10 text-[10px] font-mono uppercase tracking-widest text-muted-foreground hover:text-red-500 transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Delete
                        </button>
                      )}
                    </div>

                    <AnimatePresence initial={false}>
                      {expanded && (
                        <motion.div
                          key="preview"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.18 }}
                          className="overflow-hidden border-t border-border"
                          data-testid={`template-preview-${template.id}`}
                        >
                          <TemplatePreview template={template} />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </TechnicalCard>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}

// ─── Sub-views ─────────────────────────────────────────────────────────────

function TemplatePreview({ template }: { template: ProgramTemplate }) {
  const sortedWeeks = useMemo(
    () => [...template.weeks].sort((a, b) => a.weekNumber - b.weekNumber),
    [template.weeks],
  );
  return (
    <div className="bg-muted/20 px-5 py-4 space-y-3">
      <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
        Structure
      </p>
      <ul className="space-y-2">
        {sortedWeeks.map((w) => (
          <li key={w.id ?? w.weekNumber} className="text-xs font-mono">
            <p className="text-foreground font-bold">
              Week {w.weekNumber}
              <span className="text-muted-foreground font-normal ml-2">
                · {w.days.length} {w.days.length === 1 ? 'day' : 'days'}
              </span>
            </p>
            <ul className="ml-4 mt-1 space-y-0.5">
              {[...w.days]
                .sort((a, b) => a.dayNumber - b.dayNumber)
                .map((d) => (
                  <li
                    key={d.id ?? `${w.weekNumber}-${d.dayNumber}`}
                    className="text-muted-foreground"
                  >
                    Day {d.dayNumber} · {d.name}
                    <span className="text-muted-foreground/70 ml-2">
                      ({d.exercises.length} ex.)
                    </span>
                  </li>
                ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-12 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
      Loading templates…
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center" data-testid="template-empty">
      <Library className="w-8 h-8 text-muted-foreground mb-3" />
      <p className="text-xs font-mono text-foreground uppercase tracking-widest">
        No templates yet
      </p>
      <p className="text-[10px] font-mono text-muted-foreground/70 mt-2 max-w-xs leading-relaxed">
        Save a program as a template from the editor to start your library.
      </p>
    </div>
  );
}

function NoMatches({ query }: { query: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <Search className="w-6 h-6 text-muted-foreground mb-2" />
      <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
        No templates match "{query}"
      </p>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function countDays(template: ProgramTemplate): number {
  return template.weeks.reduce((sum, w) => sum + w.days.length, 0);
}

function countExercises(template: ProgramTemplate): number {
  return template.weeks.reduce(
    (sum, w) => sum + w.days.reduce((s, d) => s + d.exercises.length, 0),
    0,
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString();
}
