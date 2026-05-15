import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { RotateCcw } from 'lucide-react';
import { Modal, Button } from '../ui';
import type { Client, Program } from '../../types';

interface ArchivedBlocksModalProps {
  client: Client;
  onClose: () => void;
  onRestore: (clientId: string, programId: string) => Promise<void>;
}

/**
 * Coach-side viewer for a single client's archived programs. Each row shows
 * the block name, structure (weeks/days/logged sessions), archive date, and
 * a Restore action that flips status back to 'active'. Restore does NOT
 * pick up the client's `activeProgramId` — that's the caller's concern.
 */
export function ArchivedBlocksModal({ client, onClose, onRestore }: ArchivedBlocksModalProps) {
  const [restoring, setRestoring] = useState<string | null>(null);

  const archived = client.programs
    .filter((p) => p.status === 'archived')
    .sort((a, b) =>
      (b.archivedAt ?? b.createdAt ?? '').localeCompare(a.archivedAt ?? a.createdAt ?? ''),
    );

  const stats = (p: Program) => ({
    weeks: p.weeks.length,
    days: p.weeks.reduce((n, w) => n + w.days.length, 0),
    logged: p.weeks.reduce((n, w) => n + w.days.filter((d) => d.loggedAt).length, 0),
  });

  return (
    <Modal isOpen={true} onClose={onClose} title="Archived Blocks">
      {archived.length === 0 ? (
        <p
          className="font-mono text-xs text-muted-foreground py-6 text-center"
          data-testid="archived-blocks-empty"
        >
          No archived blocks for {client.name}.
        </p>
      ) : (
        <ul
          className="space-y-3 max-h-[60vh] overflow-y-auto"
          data-testid="archived-blocks-list"
        >
          {archived.map((p) => {
            const s = stats(p);
            return (
              <li
                key={p.id}
                data-testid={`archived-block-${p.id}`}
                className="border border-border/50 bg-surface/50 p-4 flex items-start justify-between gap-4"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-display font-semibold uppercase tracking-wide text-foreground">
                    {p.name}
                  </p>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mt-1">
                    {s.weeks} weeks · {s.days} days · {s.logged} sessions logged
                  </p>
                  {p.archivedAt && (
                    <p className="font-mono text-[10px] text-muted-foreground/60 mt-1">
                      Archived {format(parseISO(p.archivedAt), 'MMM d, yyyy')}
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={restoring === p.id}
                  data-testid={`restore-block-btn-${p.id}`}
                  onClick={async () => {
                    setRestoring(p.id);
                    try {
                      await onRestore(client.id, p.id);
                    } finally {
                      setRestoring(null);
                    }
                  }}
                >
                  <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                  {restoring === p.id ? 'Restoring…' : 'Restore'}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
