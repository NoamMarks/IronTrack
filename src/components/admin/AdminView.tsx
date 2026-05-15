import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, Trash2, Archive, Link2, Link as LinkIcon, Copy, Check, Library, Bell, BarChart3, Activity } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ProgramEditor } from './ProgramEditor';
import { RecentActivityPanel } from './RecentActivityPanel';
import { TemplateBrowser } from './TemplateBrowser';
import { CohortAnalytics } from './CohortAnalytics';
import { ClientNotes } from './ClientNotes';
import { BlockNotes } from './BlockNotes';
import { ArchivedBlocksModal } from './ArchivedBlocksModal';
import { Modal, Toast, Button } from '../ui';
import { cn } from '../../lib/utils';
import {
  createInviteCode,
  getInviteCodesForCoach,
  deleteInviteCode,
  buildInviteLink,
} from '../../lib/inviteCodes';
import { useTemplates, type ProgramTemplate } from '../../hooks/useTemplates';
import type { Client, Program, InviteCode, ProgramColumn, WorkoutWeek } from '../../types';

const activeProgramOf = (c: Client | null): Program | null => {
  if (!c) return null;
  const active = c.programs.filter((p) => p.status !== 'archived');
  if (active.length === 0) return null;
  // Prefer the activeProgramId the server already flagged; fall back to the
  // most recently created non-archived program so the editor always opens the
  // one the coach last built rather than a random insertion-order first.
  const preferred = c.activeProgramId
    ? active.find((p) => p.id === c.activeProgramId) ?? null
    : null;
  if (preferred) return preferred;
  return active.slice().sort((a, b) =>
    (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
  )[0] ?? null;
};

interface AdminViewProps {
  clients: Client[];
  authenticatedUser: Client;
  isLoadingData?: boolean;
  onSaveProgram: (program: Program) => Promise<void>;
  onCreateProgram: (clientId: string) => Promise<Program>;
  /** Materialise a saved template into a new live program for the given
   *  client. Provided by useProgramData so the local clients tree picks
   *  up the new program without a refetch. */
  onCreateProgramFromTemplate?: (
    clientId: string,
    template: { name: string; columns: ProgramColumn[]; weeks: WorkoutWeek[] },
  ) => Promise<Program>;
  onDeleteClient: (clientId: string) => Promise<void>;
  onArchiveProgram: (clientId: string, programId: string) => Promise<void>;
  /** Restore an archived program — flips it back to `status: 'active'`.
   *  Optional so environments without the wired-up restore action stay
   *  functional; the View Archived button still surfaces a read-only list. */
  onRestoreProgram?: (clientId: string, programId: string) => Promise<void>;
  /** Duplicate the program and return the new copy so the editor can
   *  switch to it without a refetch. Previously returned `Promise<void>` —
   *  discarding the return value left the editor on the original block
   *  with no visible feedback. */
  onDuplicateProgram?: (clientId: string, program: Program) => Promise<Program>;
  /** Send a Web Push notification to a trainee. Wired to the
   *  /api/send-notification serverless endpoint by App.tsx. Optional so
   *  builds without VAPID keys (or environments where push isn't
   *  configured) gracefully omit the Bell affordance. */
  onSendNotification?: (clientId: string, message: string) => Promise<void>;
  /** Persist `programs.coach_notes` for the given block. When omitted, the
   *  BlockNotes editor is hidden — keeps the surface clean in environments
   *  where the migration hasn't run yet. */
  onSaveBlockNotes?: (programId: string, notes: string) => Promise<void>;
  onBack: () => void;
}

export function AdminView({
  clients,
  authenticatedUser,
  isLoadingData,
  onSaveProgram,
  onCreateProgram,
  onCreateProgramFromTemplate,
  onDeleteClient,
  onArchiveProgram,
  onRestoreProgram,
  onDuplicateProgram,
  onSendNotification,
  onSaveBlockNotes,
  onBack,
}: AdminViewProps) {
  // Tenant-scoped trainees only
  const trainees = clients.filter(
    (c) => c.role === 'trainee' && c.tenantId === authenticatedUser.tenantId
  );

  const [selectedClient, setSelectedClient] = useState<Client | null>(trainees[0] ?? null);
  const [editingProgram, setEditingProgram] = useState<Program | null>(activeProgramOf(trainees[0] ?? null));

  // Invite code state — async fetched from Supabase in Phase 3.
  const [inviteCodes, setInviteCodes] = useState<InviteCode[]>([]);
  const [copied, setCopied] = useState<{ id: string; kind: 'code' | 'link' } | null>(null);

  // Template library state. The hook self-resolves the coach via auth.uid()
  // and RLS — no need to thread `authenticatedUser` through.
  const {
    templates,
    isLoading: isTemplatesLoading,
    saveTemplate,
    editTemplate,
    deleteTemplate,
  } = useTemplates();
  const [loadTemplateOpen, setLoadTemplateOpen] = useState(false);

  // Inline notification composer state — opens beneath the targeted client
  // button rather than as a modal so the coach keeps spatial context.
  const [notifyClientId, setNotifyClientId] = useState<string | null>(null);
  const [notifyDraft, setNotifyDraft] = useState('');
  const [notifySending, setNotifySending] = useState(false);

  // Cohort-analytics drawer toggle — collapses by default so the editor
  // keeps its full height when the coach is mid-edit.
  const [showCohort, setShowCohort] = useState(false);
  // Slide-out activity drawer — previously a sticky third column that
  // pushed the editor off-screen on narrower widths.
  const [showActivity, setShowActivity] = useState(false);
  // Archived-blocks viewer — modal listing the client's archived programs
  // with a Restore action per row.
  const [showArchived, setShowArchived] = useState(false);

  // Load invite codes
  useEffect(() => {
    let cancelled = false;
    void getInviteCodesForCoach(authenticatedUser.id).then((codes) => {
      if (!cancelled) setInviteCodes(codes);
    });
    return () => { cancelled = true; };
  }, [authenticatedUser.id]);

  // ── Debounced save ──────────────────────────────────────────────────────
  // Keystrokes coalesce into a single saveProgram call after the user stops
  // typing for SAVE_DEBOUNCE_MS. Without this, every keystroke fired its own
  // multi-round-trip Supabase write, and the resulting in-flight saves
  // landed out of order, clobbering the input with stale values.
  const SAVE_DEBOUNCE_MS = 500;
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<Program | null>(null);

  const flushSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const toSave = pendingSaveRef.current;
    pendingSaveRef.current = null;
    if (!toSave) return;
    void onSaveProgram(toSave).catch((err) => {
      console.error('[IronTrack admin] saveProgram failed', err);
    });
  }, [onSaveProgram]);

  // Flush on unmount so the user doesn't lose the last keystroke if they
  // navigate away inside SAVE_DEBOUNCE_MS.
  useEffect(() => {
    return () => {
      flushSave();
    };
  }, [flushSave]);

  // ── Keep the editing program in sync with the live store ────────────────
  // External mutations (archive, delete-client, program created on another
  // client) flow in via clients[]. We must NOT clobber the local
  // `editingProgram` while the user is actively editing — saveProgram
  // already merges the saved program into clients[], so the in-progress
  // draft is what the user has typed. Only re-derive when:
  //   (a) the selected client was deleted out from under us
  //   (b) the current draft no longer exists in the fresh tree
  //   (c) the current draft was archived externally
  useEffect(() => {
    if (!selectedClient) return;
    const fresh = clients.find((c) => c.id === selectedClient.id);
    if (!fresh) {
      setSelectedClient(null);
      setEditingProgram(null);
      return;
    }
    setSelectedClient(fresh);
    setEditingProgram((prev) => {
      if (!prev) return activeProgramOf(fresh);
      const stillActive = fresh.programs.find(
        (p) => p.id === prev.id && p.status !== 'archived',
      );
      // Returning prev here causes React to bail out of the re-render —
      // crucially, it leaves the user's in-flight keystrokes untouched.
      return stillActive ? prev : activeProgramOf(fresh);
    });
  }, [clients]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectClient = (client: Client) => {
    // Persist whatever the coach was just typing on the previous client
    // before we swap the editor over.
    flushSave();
    setSelectedClient(client);
    setEditingProgram(activeProgramOf(client));
  };

  const handleCreateProgram = async () => {
    if (!selectedClient) return;
    try {
      const newProgram = await onCreateProgram(selectedClient.id);
      setEditingProgram(newProgram);
    } catch (err) {
      console.error('[IronTrack admin] createProgram failed', err);
    }
  };

  // Save the program currently in the editor as a reusable template. The
  // ProgramEditor renders the modal and delegates to this handler so the
  // editor stays presentational and the templates hook stays scoped to
  // AdminView.
  const handleSaveAsTemplate = useCallback(
    async (name: string, description: string) => {
      if (!editingProgram) {
        throw new Error('No active program to save.');
      }
      // Flush any in-flight debounced edits FIRST so the snapshot reflects
      // the absolute latest state of the editor — without this, saving a
      // template right after a keystroke captures the pre-edit version.
      flushSave();
      await saveTemplate(name, editingProgram, description);
    },
    [editingProgram, flushSave, saveTemplate],
  );

  const handleLoadTemplate = useCallback(
    async (template: ProgramTemplate) => {
      if (!selectedClient || !onCreateProgramFromTemplate) return;
      try {
        const newProgram = await onCreateProgramFromTemplate(selectedClient.id, {
          name: template.name,
          columns: template.columns,
          weeks: template.weeks,
        });
        setEditingProgram(newProgram);
        setLoadTemplateOpen(false);
      } catch (err) {
        console.error('[IronTrack admin] loadTemplate failed', err);
      }
    },
    [selectedClient, onCreateProgramFromTemplate],
  );

  const handleArchiveProgram = async () => {
    if (!selectedClient || !editingProgram) return;
    if (
      !window.confirm(
        `Archive "${editingProgram.name}"? It will move to the trainee's history and you can build a new block.`,
      )
    ) return;
    // Persist any keystrokes still in the debounce window before archiving,
    // so we're not throwing away the coach's last edits.
    flushSave();
    try {
      await onArchiveProgram(selectedClient.id, editingProgram.id);
      // Jump to the client's next active program rather than the empty
      // state — reading the empty state as "the archived block is still
      // around" was the source of the original bug report.
      // `clients` is mutated in place by useProgramData, so the freshest
      // snapshot is already on the array we hold.
      const fresh = clients.find((c) => c.id === selectedClient.id) ?? selectedClient;
      setEditingProgram(activeProgramOf(fresh));
      setDupeToast('Program archived');
      setTimeout(() => setDupeToast(null), 3000);
    } catch (err) {
      console.error('[IronTrack admin] archiveProgram failed', err);
    }
  };

  const [dupeToast, setDupeToast] = useState<string | null>(null);

  const handleDuplicateProgram = async () => {
    if (!selectedClient || !editingProgram || !onDuplicateProgram) return;
    try {
      const newProgram = await onDuplicateProgram(selectedClient.id, editingProgram);
      // Switch the editor over to the copy. Without this swap, the coach
      // is left looking at the original block and the duplicate appears
      // to have done nothing.
      setEditingProgram(newProgram);
      setDupeToast('Block duplicated — now editing the copy');
      setTimeout(() => setDupeToast(null), 3000);
    } catch (err) {
      console.error('[IronTrack admin] duplicateProgram failed', err);
    }
  };

  const handleDeleteClient = async (clientId: string) => {
    if (!window.confirm('Remove this client and all their data? This cannot be undone.')) return;
    try {
      await onDeleteClient(clientId);
      if (selectedClient?.id === clientId) {
        const nextTrainee = clients.filter(
          (c) => c.role === 'trainee' && c.tenantId === authenticatedUser.tenantId && c.id !== clientId,
        )[0] ?? null;
        setSelectedClient(nextTrainee);
        setEditingProgram(nextTrainee ? activeProgramOf(nextTrainee) : null);
      }
    } catch (err) {
      console.error('[IronTrack admin] deleteClient failed', err);
    }
  };

  const handleProgramChange = (updated: Program) => {
    if (!selectedClient) return;
    // Optimistic local update — the editor renders instantly off this state.
    setEditingProgram(updated);
    // Coalesce rapid keystrokes into a single Supabase write. The latest
    // `updated` always wins because we replace pendingSaveRef each call.
    pendingSaveRef.current = updated;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
  };

  const [inviteError, setInviteError] = useState<string | null>(null);

  const handleGenerateInvite = async () => {
    try {
      const invite = await createInviteCode(
        authenticatedUser.id,
        authenticatedUser.tenantId ?? authenticatedUser.id,
        authenticatedUser.name,
      );
      setInviteCodes((prev) => [...prev, invite]);
      setInviteError(null);
    } catch (err) {
      console.error('[IronTrack invite] generation failed', err);
      setInviteError(err instanceof Error ? err.message : 'Could not generate invite code.');
    }
  };

  const handleDeleteInvite = async (codeId: string) => {
    await deleteInviteCode(codeId);
    setInviteCodes((prev) => prev.filter((c) => c.id !== codeId));
  };

  const handleCopy = async (id: string, value: string, kind: 'code' | 'link') => {
    await navigator.clipboard.writeText(value);
    setCopied({ id, kind });
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="space-y-10">
      {/* Header */}
      <header className="flex justify-between items-end">
        <div className="flex items-center space-x-8">
          <motion.button
            whileHover={{ x: -4 }}
            onClick={onBack}
            className="p-3 hover:bg-muted transition-colors rounded-sm"
          >
            <ArrowLeft className="w-8 h-8 text-foreground" />
          </motion.button>
          <div>
            <h1 className="text-5xl font-bold tracking-tighter uppercase font-display text-foreground">
              Admin Panel
            </h1>
            <p className="text-muted-foreground font-mono text-xs mt-1 uppercase tracking-widest">
              Program &amp; Client Architect
            </p>
          </div>
        </div>
      </header>

      {/* Invite Codes Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-mono uppercase text-muted-foreground tracking-widest">
            Invite Codes
          </h3>
          <button
            onClick={() => void handleGenerateInvite()}
            data-testid="generate-invite-btn"
            className="btn-press flex items-center gap-2 px-4 py-2 text-[10px] font-mono uppercase tracking-widest border border-border hover:border-accent hover:text-accent rounded-input transition-colors"
          >
            <Link2 className="w-3 h-3" />
            Generate Code
          </button>
        </div>
        {inviteError && (
          <p className="text-[10px] font-mono text-red-500" data-testid="invite-generation-error">
            {inviteError}
          </p>
        )}
        {inviteCodes.length > 0 && (
          <div className="flex flex-wrap gap-3">
            <AnimatePresence initial={false}>
              {inviteCodes.map((inv) => {
                // Treat both undefined and null (and zero) as unlimited so a
                // stale localStorage payload doesn't render as "0/null" or as
                // an instantly-expired fraction.
                const isUnlimited = inv.maxUses == null || inv.maxUses <= 0;
                const usageLabel = isUnlimited
                  ? `${inv.useCount ?? 0} uses · ∞`
                  : `${inv.useCount ?? 0}/${inv.maxUses}`;
                const link = buildInviteLink(inv.code);
                return (
                  <motion.div
                    key={inv.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.18 }}
                    className="flex items-center gap-3 px-4 py-2.5 bg-muted/30 border border-border rounded-lg text-sm font-mono"
                  >
                    <div className="flex flex-col">
                      <span
                        className="tracking-widest font-bold text-foreground"
                        data-testid={`invite-code-${inv.id}`}
                      >
                        {inv.code}
                      </span>
                      <span className="text-[9px] text-muted-foreground uppercase tracking-widest">
                        {usageLabel}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => void handleCopy(inv.id, inv.code, 'code')}
                        className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                        title="Copy code"
                      >
                        {copied?.id === inv.id && copied.kind === 'code' ? (
                          <Check className="w-3 h-3 text-green-500" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                      <button
                        onClick={() => void handleCopy(inv.id, link, 'link')}
                        data-testid={`copy-link-${inv.id}`}
                        className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-mono uppercase tracking-widest border border-border hover:border-muted-foreground hover:text-foreground transition-all rounded-md text-muted-foreground"
                        title="Copy invite link"
                      >
                        {copied?.id === inv.id && copied.kind === 'link' ? (
                          <>
                            <Check className="w-3 h-3 text-green-500" />
                            Copied
                          </>
                        ) : (
                          <>
                            <LinkIcon className="w-3 h-3" />
                            Copy Link
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => void handleDeleteInvite(inv.id)}
                        className="p-1.5 text-muted-foreground hover:text-red-500 transition-colors"
                        title="Delete code"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>

      <div className="grid grid-cols-[300px_1fr] gap-8">
        {/* Client list */}
        <div className="space-y-6">
          <h3 className="text-xs font-mono uppercase text-primary/60 tracking-widest border-b border-primary/20 pb-2">
            Select Client
          </h3>
          <div className="space-y-3">
            {isLoadingData && trainees.length === 0 && (
              <p className="text-xs font-mono text-muted-foreground" data-testid="admin-loading">
                Loading clients…
              </p>
            )}
            {trainees.map((c) => (
              <div key={c.id} className="relative group">
                <button
                  onClick={() => handleSelectClient(c)}
                  className={cn(
                    'w-full text-left p-6 border transition-all rounded-sm pr-20',
                    selectedClient?.id === c.id
                      ? 'bg-primary/10 text-primary border border-primary shadow-glow-primary scale-[1.02]'
                      : 'border-border hover:border-primary/50 bg-surface/50'
                  )}
                >
                  <p className="font-bold text-lg tracking-tight">{c.name}</p>
                  <p className="text-[10px] font-mono opacity-60 uppercase tracking-widest mt-1">
                    {c.email}
                  </p>
                </button>

                {/* Bell — opens an inline notification composer below this
                    client. Hidden when the parent didn't wire onSendNotification
                    (e.g. environments without VAPID keys). */}
                {onSendNotification && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setNotifyClientId(notifyClientId === c.id ? null : c.id);
                      setNotifyDraft('');
                    }}
                    aria-label={`Notify ${c.name}`}
                    title="Send push notification"
                    data-testid={`notify-trigger-${c.id}`}
                    className="absolute top-3 right-10 p-1.5 text-muted-foreground hover:text-primary transition-colors"
                  >
                    <Bell className="w-3.5 h-3.5" />
                  </button>
                )}

                {/* Reset-password is unavailable in Phase 3 (would need a server-side
                    Supabase admin function). Trainees self-serve via Forgot Password. */}
                <button
                  onClick={(e) => { e.stopPropagation(); void handleDeleteClient(c.id); }}
                  className="absolute top-3 right-3 p-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-red-500 transition-all"
                  title="Remove client"
                >
                  <Trash2 className="w-4 h-4" />
                </button>

                {notifyClientId === c.id && onSendNotification && (
                  <div
                    className="mt-2 p-3 bg-surface border border-primary/20 space-y-2"
                    data-testid={`notify-composer-${c.id}`}
                  >
                    <textarea
                      value={notifyDraft}
                      onChange={(e) => setNotifyDraft(e.target.value.slice(0, 140))}
                      placeholder="Message to trainee..."
                      rows={2}
                      data-testid={`notify-textarea-${c.id}`}
                      className="w-full bg-transparent border-b border-primary/30 focus:border-primary text-xs font-mono text-foreground outline-none resize-none placeholder:text-muted-foreground/40"
                    />
                    <div className="flex gap-2 justify-end items-center">
                      <span className="text-[9px] font-mono text-muted-foreground/60 tabular-nums mr-auto">
                        {notifyDraft.length}/140
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { setNotifyClientId(null); setNotifyDraft(''); }}
                        disabled={notifySending}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={!notifyDraft.trim() || notifySending}
                        data-testid={`notify-send-btn-${c.id}`}
                        onClick={async () => {
                          setNotifySending(true);
                          try {
                            await onSendNotification(c.id, notifyDraft.trim());
                            setNotifyClientId(null);
                            setNotifyDraft('');
                          } finally {
                            setNotifySending(false);
                          }
                        }}
                      >
                        <Bell className="w-3 h-3 mr-1" />
                        {notifySending ? 'Sending' : 'Send'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          {selectedClient && (
            <div className="mt-4 pt-4 border-t border-primary/15">
              <ClientNotes
                clientId={selectedClient.id}
                coachId={authenticatedUser.id}
              />
            </div>
          )}
        </div>

        {/* Program editor */}
        <div className="space-y-6">
          {editingProgram ? (
            <>
              <div className="flex justify-end items-center gap-2 flex-wrap">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowActivity(true)}
                  data-testid="open-activity-drawer"
                >
                  <Activity className="w-3.5 h-3.5 mr-1.5" />
                  Activity
                </Button>
                <Button
                  variant={showCohort ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={() => setShowCohort((v) => !v)}
                  data-testid="cohort-analytics-btn"
                >
                  <BarChart3 className="w-3.5 h-3.5 mr-1.5" />
                  {showCohort ? 'Hide Cohort' : 'Cohort View'}
                </Button>
                {selectedClient && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowArchived(true)}
                    data-testid="view-archived-btn"
                  >
                    <Archive className="w-3.5 h-3.5 mr-1.5" />
                    View Archived ({selectedClient.programs.filter((p) => p.status === 'archived').length})
                  </Button>
                )}
                {onDuplicateProgram && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleDuplicateProgram()}
                    data-testid="duplicate-block-btn"
                  >
                    <Copy className="w-3.5 h-3.5 mr-1.5" />
                    Duplicate Block
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleArchiveProgram}
                  data-testid="archive-block-btn"
                >
                  <Archive className="w-3.5 h-3.5 mr-1.5" />
                  Archive Block
                </Button>
              </div>

              <AnimatePresence>
                {showCohort && (
                  <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2 }}
                    className="mt-4"
                  >
                    <CohortAnalytics trainees={trainees} />
                  </motion.div>
                )}
              </AnimatePresence>
              {onSaveBlockNotes && (
                <BlockNotes
                  program={editingProgram}
                  onSave={async (notes) => { await onSaveBlockNotes(editingProgram.id, notes); }}
                />
              )}
              <ProgramEditor
                program={editingProgram}
                onChange={handleProgramChange}
                onSaveAsTemplate={handleSaveAsTemplate}
              />
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-32 space-y-6">
              <p className="text-muted-foreground font-mono text-xs uppercase tracking-widest">
                No program assigned
              </p>
              <h2 className="text-3xl font-display font-bold uppercase tracking-widest text-foreground">
                Ready to Build?
              </h2>
              <div className="flex flex-wrap gap-3 justify-center">
                <Button
                  variant="primary"
                  onClick={handleCreateProgram}
                  data-testid="create-block-btn"
                >
                  Create New Block
                </Button>
                {onCreateProgramFromTemplate && (
                  <Button
                    variant="ghost"
                    onClick={() => setLoadTemplateOpen(true)}
                    data-testid="open-template-browser-btn"
                  >
                    <Library className="w-3.5 h-3.5 mr-1.5" />
                    Load from Template
                  </Button>
                )}
              </div>
              {onCreateProgramFromTemplate && templates.length > 0 && (
                <p className="text-[10px] font-mono text-muted-foreground/70 uppercase tracking-widest">
                  {templates.length} {templates.length === 1 ? 'template' : 'templates'} in your library
                </p>
              )}
            </div>
          )}
        </div>

      </div>

      {/* Recent activity drawer — slides in from the right on demand. The
          realtime subscription only mounts while the drawer is open, so we
          don't pay for the channel when the coach isn't watching. */}
      <AnimatePresence>
        {showActivity && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[150] bg-background/70 backdrop-blur-sm"
              onClick={() => setShowActivity(false)}
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 36 }}
              className="fixed top-0 right-0 bottom-0 z-[151] w-full max-w-md flex flex-col"
            >
              <RecentActivityPanel
                tenantId={authenticatedUser.tenantId ?? authenticatedUser.id}
                className="flex-1 h-full"
                onClose={() => setShowActivity(false)}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Archived blocks modal */}
      {showArchived && selectedClient && (
        <ArchivedBlocksModal
          client={selectedClient}
          onClose={() => setShowArchived(false)}
          onRestore={async (clientId, programId) => {
            await onRestoreProgram?.(clientId, programId);
          }}
        />
      )}

      {/* Version footer */}
      <div className="text-center text-[10px] font-mono text-muted-foreground/50 uppercase tracking-widest pt-4">
        IronTrack v{__APP_VERSION__}
      </div>

      {/* Load-from-Template modal — wraps the reusable TemplateBrowser with
          an onLoad action wired to createProgramFromTemplate. The browser
          itself still renders without a Load action when used elsewhere
          (e.g. a future "manage my library" surface). */}
      <Modal
        isOpen={loadTemplateOpen}
        onClose={() => setLoadTemplateOpen(false)}
        title="Load from Template"
      >
        <TemplateBrowser
          templates={templates}
          isLoading={isTemplatesLoading}
          onLoad={handleLoadTemplate}
          onEdit={editTemplate}
          onDelete={async (t) => { await deleteTemplate(t.id); }}
          className="max-h-[60vh] overflow-y-auto pr-1"
        />
      </Modal>
      <Toast message={dupeToast} onDismiss={() => setDupeToast(null)} />
    </div>
  );
}