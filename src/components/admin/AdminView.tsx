import { useState, useEffect } from 'react';
import { ArrowLeft, Trash2, Archive, Link2, Link as LinkIcon, Copy, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ProgramEditor } from './ProgramEditor';
import { cn } from '../../lib/utils';
import {
  createInviteCode,
  getInviteCodesForCoach,
  deleteInviteCode,
  buildInviteLink,
} from '../../lib/inviteCodes';
import type { Client, Program, InviteCode } from '../../types';

const activeProgramOf = (c: Client | null): Program | null =>
  c?.programs.find((p) => p.status !== 'archived') ?? null;

interface AdminViewProps {
  clients: Client[];
  authenticatedUser: Client;
  isLoadingData?: boolean;
  onSaveProgram: (program: Program) => Promise<void>;
  onCreateProgram: (clientId: string) => Promise<Program>;
  onDeleteClient: (clientId: string) => Promise<void>;
  onArchiveProgram: (clientId: string, programId: string) => Promise<void>;
  onBack: () => void;
}

export function AdminView({
  clients,
  authenticatedUser,
  isLoadingData,
  onSaveProgram,
  onCreateProgram,
  onDeleteClient,
  onArchiveProgram,
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

  // Load invite codes
  useEffect(() => {
    let cancelled = false;
    void getInviteCodesForCoach(authenticatedUser.id).then((codes) => {
      if (!cancelled) setInviteCodes(codes);
    });
    return () => { cancelled = true; };
  }, [authenticatedUser.id]);

  // Keep the editing program in sync with the live store after archive/save
  useEffect(() => {
    if (!selectedClient) return;
    const fresh = clients.find((c) => c.id === selectedClient.id);
    if (!fresh) return;
    setSelectedClient(fresh);
    const stillExists = editingProgram
      ? fresh.programs.find((p) => p.id === editingProgram.id && p.status !== 'archived')
      : null;
    setEditingProgram(stillExists ?? activeProgramOf(fresh));
  }, [clients]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectClient = (client: Client) => {
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

  const handleArchiveProgram = async () => {
    if (!selectedClient || !editingProgram) return;
    if (
      !window.confirm(
        `Archive "${editingProgram.name}"? It will move to the trainee's history and you can build a new block.`,
      )
    ) return;
    try {
      await onArchiveProgram(selectedClient.id, editingProgram.id);
      setEditingProgram(null);
    } catch (err) {
      console.error('[IronTrack admin] archiveProgram failed', err);
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
    // Optimistic local update so the editor is responsive — onSaveProgram
    // syncs to Supabase in the background and refetches the canonical tree.
    setEditingProgram(updated);
    void onSaveProgram(updated).catch((err) => {
      console.error('[IronTrack admin] saveProgram failed', err);
    });
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

      <div className="grid grid-cols-[300px_1fr] gap-12">
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
              <div className="flex justify-end">
                <button
                  onClick={handleArchiveProgram}
                  data-testid="archive-block-btn"
                  className="flex items-center gap-2 px-4 py-2 text-[10px] font-mono uppercase tracking-widest border border-amber-500/50 text-amber-500 hover:bg-amber-500 hover:text-background transition-all"
                >
                  <Archive className="w-4 h-4" />
                  Archive Current Block
                </button>
              </div>
              <ProgramEditor program={editingProgram} onChange={handleProgramChange} />
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-32 space-y-6">
              <p className="text-muted-foreground font-mono text-xs uppercase tracking-widest">
                No program assigned
              </p>
              <h2 className="text-4xl font-bold italic font-serif text-foreground tracking-tight">
                Ready to Build?
              </h2>
              <button
                onClick={handleCreateProgram}
                className="bg-foreground text-background px-8 py-4 text-xs font-bold uppercase tracking-widest hover:opacity-90 transition-all shadow-lg"
              >
                + Create New Block
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Version footer */}
      <div className="text-center text-[10px] font-mono text-muted-foreground/50 uppercase tracking-widest pt-4">
        IronTrack v{__APP_VERSION__}
      </div>
    </div>
  );
}