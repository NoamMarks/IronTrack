import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, Trash2, Archive, Link2, Link as LinkIcon, Copy, Check, Library } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ProgramEditor } from './ProgramEditor';
import { RecentActivityPanel } from './RecentActivityPanel';
import { TemplateBrowser } from './TemplateBrowser';
import { Modal, Toast } from '../ui';
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
  onDuplicateProgram?: (clientId: string, program: Program) => Promise<void>;
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
  onDuplicateProgram,
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
    deleteTemplate,
  } = useTemplates();
  const [loadTemplateOpen, setLoadTemplateOpen] = useState(false);

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
      setEditingProgram(null);
    } catch (err) {
      console.error('[IronTrack admin] archiveProgram failed', err);
    }
  };

  const [dupeToast, setDupeToast] = useState<string | null>(null);

  const handleDuplicateProgram = async () => {
    if (!selectedClient || !editingProgram || !onDuplicateProgram) return;
    try {
      await onDuplicateProgram(selectedClient.id, editingProgram);
      setDupeToast('Program duplicated successfully');
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
            <h1 className="text-5xl font-bold tracking-tighter uppercase italic font-serif text-foreground">
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

      <div className="grid grid-cols-[300px_1fr] xl:grid-cols-[300px_1fr_320px] gap-8 xl:gap-10">
        {/* Client list */}
        <div className="space-y-6">
          <h3 className="text-xs font-mono uppercase text-muted-foreground tracking-widest border-b border-border pb-2">
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
                    'w-full text-left p-6 border transition-all rounded-sm pr-12',
                    selectedClient?.id === c.id
                      ? 'bg-foreground text-background border-foreground shadow-lg scale-[1.02]'
                      : 'border-border hover:border-muted-foreground bg-card'
                  )}
                >
                  <p className="font-bold text-lg tracking-tight">{c.name}</p>
                  <p className="text-[10px] font-mono opacity-60 uppercase tracking-widest mt-1">
                    {c.email}
                  </p>
                </button>
                {/* Reset-password is unavailable in Phase 3 (would need a server-side
                    Supabase admin function). Trainees self-serve via Forgot Password. */}
                <button
                  onClick={(e) => { e.stopPropagation(); void handleDeleteClient(c.id); }}
                  className="absolute top-3 right-3 p-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-red-500 transition-all"
                  title="Remove client"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Program editor */}
        <div className="space-y-6">
          {editingProgram ? (
            <>
              <div className="flex justify-end items-center gap-2">
                {onDuplicateProgram && (
                  <button
                    onClick={() => void handleDuplicateProgram()}
                    data-testid="duplicate-block-btn"
                    className="flex items-center gap-2 px-4 py-2 text-[10px] font-mono uppercase tracking-widest border border-border text-muted-foreground hover:bg-foreground hover:text-background transition-all"
                  >
                    <Copy className="w-4 h-4" />
                    Duplicate Block
                  </button>
                )}
                <button
                  onClick={handleArchiveProgram}
                  data-testid="archive-block-btn"
                  className="flex items-center gap-2 px-4 py-2 text-[10px] font-mono uppercase tracking-widest border border-amber-500/50 text-amber-500 hover:bg-amber-500 hover:text-background transition-all"
                >
                  <Archive className="w-4 h-4" />
                  Archive Current Block
                </button>
              </div>
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
              <h2 className="text-4xl font-bold italic font-serif text-foreground tracking-tight">
                Ready to Build?
              </h2>
              <div className="flex flex-wrap gap-3 justify-center">
                <button
                  onClick={handleCreateProgram}
                  data-testid="create-block-btn"
                  className="bg-foreground text-background px-8 py-4 text-xs font-bold uppercase tracking-widest hover:opacity-90 transition-all shadow-lg"
                >
                  + Create New Block
                </button>
                {onCreateProgramFromTemplate && (
                  <button
                    onClick={() => setLoadTemplateOpen(true)}
                    data-testid="open-template-browser-btn"
                    className="flex items-center gap-2 border border-foreground text-foreground px-8 py-4 text-xs font-bold uppercase tracking-widest hover:bg-foreground hover:text-background transition-all shadow-sm"
                  >
                    <Library className="w-4 h-4" />
                    Load from Template
                  </button>
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

        {/* Recent activity — third column on xl+, hidden on smaller widths
            so the program editor keeps room to breathe. The realtime
            subscription stays mounted whenever this is rendered, so the
            feed populates the moment a trainee submits a reflection. */}
        <RecentActivityPanel
          tenantId={authenticatedUser.tenantId ?? authenticatedUser.id}
          className="hidden xl:flex sticky top-24 self-start max-h-[calc(100vh-9rem)]"
        />
      </div>

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
          onDelete={async (t) => { await deleteTemplate(t.id); }}
          className="max-h-[60vh] overflow-y-auto pr-1"
        />
      </Modal>
      <Toast message={dupeToast} onDismiss={() => setDupeToast(null)} />
    </div>
  );
}