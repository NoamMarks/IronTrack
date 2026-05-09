import { useMemo, useState } from 'react';
import {
  Trash2,
  Search,
  FileText,
  ChevronRight,
  ChevronDown,
  Library,
  Loader2,
  Pencil,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { TechnicalCard, Button } from '../ui';
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
  /** When provided, each row exposes an Edit action that surfaces an inline
   *  name + description form. Omit to hide editing. */
  onEdit?: (id: string, name: string, description: string) => Promise<void>;
  /** Optional className for the outer container — lets callers control
   *  height (e.g. constrained inside a modal vs. sticky in a sidebar). */
  className?: string;
  /** Hide the search box — useful when the list is short or when the
   *  parent provides its own filter. */
  hideSearch?: boolean;
}

/**
 * Coach's template library — FUI brutalist list with chevron-toggle preview,
 * inline edit form, and a confirm-in-place delete row (no native confirm()
 * dialog so the look stays consistent with the rest of the app).
 */
export function TemplateBrowser({
  templates,
  isLoading = false,
  onLoad,
  onDelete,
  onEdit,
  className,
  hideSearch = false,
}: TemplateBrowserProps) {
  const [query, setQuery] = useState('');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ name: string; description: string }>({
    name: '',
    description: '',
  });
  const [editSaving, setEditSaving] = useState(false);

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
    setBusyId(template.id);
    try {
      await onDelete(template);
    } finally {
      setBusyId(null);
      setConfirmDeleteId(null);
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

  const handleEditStart = (template: ProgramTemplate) => {
    setEditingId(template.id);
    setEditDraft({ name: template.name, description: template.description ?? '' });
    setConfirmDeleteId(null);
  };

  const handleEditSave = async (template: ProgramTemplate) => {
    if (!onEdit) return;
    if (!editDraft.name.trim()) return;
    setEditSaving(true);
    try {
      await onEdit(template.id, editDraft.name, editDraft.description);
      setEditingId(null);
    } finally {
      setEditSaving(false);
    }
  };

  return (
    <div data-testid="template-browser" className={cn('flex flex-col gap-4', className)}>
      {!hideSearch && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search templates..."
            data-testid="template-search"
            className="bg-transparent border-b border-primary/30 focus:border-primary pl-8 pr-4 py-3 font-mono text-sm text-foreground placeholder:text-muted-foreground/40 outline-none w-full"
          />
          {query && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono text-muted-foreground tabular-nums">
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
              const editing = editingId === template.id;
              const confirming = confirmDeleteId === template.id;
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
                  <TechnicalCard className="overflow-hidden">
                    <div className="px-5 py-4 flex items-start gap-4">
                      <div className="w-10 h-10 border border-primary/30 flex items-center justify-center shrink-0 text-primary">
                        <FileText className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-display font-semibold uppercase tracking-wide text-foreground truncate">
                          {template.name}
                        </h3>
                        {template.description && (
                          <p className="font-mono text-xs text-muted-foreground/80 leading-relaxed mt-1 line-clamp-2">
                            {template.description}
                          </p>
                        )}
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/60">
                          <span>
                            <span className="text-primary/80 font-bold tabular-nums">{template.weeks.length}</span>{' '}
                            {template.weeks.length === 1 ? 'week' : 'weeks'}
                          </span>
                          <span>·</span>
                          <span>
                            <span className="text-primary/80 font-bold tabular-nums">{countDays(template)}</span>{' '}
                            {countDays(template) === 1 ? 'day' : 'days'}
                          </span>
                          <span>·</span>
                          <span>
                            <span className="text-primary/80 font-bold tabular-nums">{countExercises(template)}</span>{' '}
                            ex.
                          </span>
                          <span>·</span>
                          <span>{formatDate(template.createdAt)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Action row — chevron toggles inline preview, then the
                        explicit Edit/Load/Delete buttons line up on the right. */}
                    <div
                      className="px-5 py-3 border-t border-border/50 flex items-center justify-between gap-3 flex-wrap"
                      data-testid={`template-actions-${template.id}`}
                    >
                      <button
                        type="button"
                        onClick={() => togglePreview(template.id)}
                        data-testid={`template-preview-btn-${template.id}`}
                        aria-expanded={expanded}
                        aria-label={expanded ? 'Hide preview' : 'Show preview'}
                        className="p-1.5 border border-border/50 text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                      >
                        {expanded
                          ? <ChevronDown className="w-3.5 h-3.5" />
                          : <ChevronRight className="w-3.5 h-3.5" />}
                      </button>
                      <div className="flex flex-wrap gap-2">
                        {onEdit && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEditStart(template)}
                            disabled={busy || editing}
                            data-testid={`template-edit-btn-${template.id}`}
                            className="inline-flex items-center gap-1.5"
                          >
                            <Pencil className="w-3 h-3" />
                            Edit
                          </Button>
                        )}
                        {onLoad && (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => void handleLoad(template)}
                            disabled={busy}
                            data-testid={`template-load-btn-${template.id}`}
                          >
                            {busy ? 'Loading...' : 'Load'}
                          </Button>
                        )}
                        {onDelete && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setConfirmDeleteId(template.id)}
                            disabled={busy || confirming}
                            data-testid={`template-delete-btn-${template.id}`}
                            className="text-danger hover:border-danger/50 inline-flex items-center gap-1.5"
                          >
                            <Trash2 className="w-3 h-3" />
                            Delete
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Inline delete confirmation — replaces window.confirm() */}
                    <AnimatePresence initial={false}>
                      {confirming && (
                        <motion.div
                          key="confirm"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.15 }}
                          className="overflow-hidden border-t border-danger/30 bg-danger/5"
                          data-testid={`template-confirm-delete-${template.id}`}
                        >
                          <div className="px-5 py-3 flex items-center justify-between gap-3 flex-wrap">
                            <span className="font-mono text-[10px] uppercase tracking-widest text-danger">
                              Delete "{template.name}"?
                            </span>
                            <div className="flex gap-2">
                              <Button
                                variant="danger"
                                size="sm"
                                onClick={() => void handleDelete(template)}
                                disabled={busy}
                                data-testid={`template-confirm-delete-btn-${template.id}`}
                              >
                                {busy ? 'Deleting...' : 'Confirm Delete'}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setConfirmDeleteId(null)}
                                disabled={busy}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Inline edit form */}
                    <AnimatePresence initial={false}>
                      {editing && (
                        <motion.div
                          key="edit"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.18 }}
                          className="overflow-hidden border-t border-primary/20 bg-primary/5"
                          data-testid={`template-edit-form-${template.id}`}
                        >
                          <div className="px-5 py-4 space-y-2">
                            <input
                              value={editDraft.name}
                              onChange={(e) =>
                                setEditDraft((d) => ({ ...d, name: e.target.value }))
                              }
                              placeholder="Template name"
                              data-testid={`template-edit-name-${template.id}`}
                              className="w-full bg-surface border-b border-primary/30 p-2 font-mono text-sm text-foreground outline-none focus:border-primary"
                            />
                            <textarea
                              value={editDraft.description}
                              onChange={(e) =>
                                setEditDraft((d) => ({ ...d, description: e.target.value }))
                              }
                              rows={2}
                              placeholder="Description (optional)"
                              data-testid={`template-edit-description-${template.id}`}
                              className="w-full bg-surface border-b border-primary/30 p-2 font-mono text-xs text-foreground outline-none focus:border-primary resize-none"
                            />
                            <div className="flex gap-2">
                              <Button
                                variant="primary"
                                size="sm"
                                onClick={() => void handleEditSave(template)}
                                disabled={editSaving || !editDraft.name.trim()}
                                data-testid={`template-edit-save-${template.id}`}
                              >
                                {editSaving ? 'Saving...' : 'Save'}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setEditingId(null)}
                                disabled={editSaving}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <AnimatePresence initial={false}>
                      {expanded && (
                        <motion.div
                          key="preview"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.18 }}
                          className="overflow-hidden border-t border-border/50"
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
    <div className="bg-surface/40 px-5 py-4 space-y-3">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        Structure
      </p>
      <ul className="space-y-3">
        {sortedWeeks.map((w) => (
          <li key={w.id ?? w.weekNumber} className="space-y-1.5">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Week {w.weekNumber}
              <span className="text-muted-foreground/50 ml-2 normal-case">
                · {w.days.length} {w.days.length === 1 ? 'day' : 'days'}
              </span>
            </p>
            <ul className="ml-4 space-y-2 border-l border-primary/10 pl-3">
              {[...w.days]
                .sort((a, b) => a.dayNumber - b.dayNumber)
                .map((d) => (
                  <li key={d.id ?? `${w.weekNumber}-${d.dayNumber}`} className="space-y-1">
                    <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      Day {d.dayNumber} · {d.name}
                    </p>
                    {d.exercises.length > 0 && (
                      <ul className="ml-3 space-y-0.5">
                        {d.exercises.map((ex) => (
                          <li
                            key={ex.id}
                            className="font-mono text-xs text-foreground/70 truncate"
                          >
                            {ex.exerciseName}
                          </li>
                        ))}
                      </ul>
                    )}
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
    <div
      className="flex flex-col items-center justify-center px-6 py-12 text-center"
      data-testid="template-loading"
    >
      <div className="w-10 h-10 border border-border/50 flex items-center justify-center mb-3 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
      </div>
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        Loading templates…
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center" data-testid="template-empty">
      <div className="w-10 h-10 border border-border/50 flex items-center justify-center mb-3 text-muted-foreground">
        <Library className="w-4 h-4" />
      </div>
      <p className="font-mono text-[10px] uppercase tracking-widest text-foreground">
        No templates yet
      </p>
      <p className="font-mono text-[10px] text-muted-foreground/70 mt-2 max-w-xs leading-relaxed">
        Save a program as a template from the editor to start your library.
      </p>
    </div>
  );
}

function NoMatches({ query }: { query: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <div className="w-10 h-10 border border-border/50 flex items-center justify-center mb-3 text-muted-foreground">
        <Search className="w-4 h-4" />
      </div>
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
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
