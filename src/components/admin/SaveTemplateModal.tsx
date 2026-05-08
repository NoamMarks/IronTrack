import { useEffect, useState } from 'react';
import { Modal, TechnicalInput } from '../ui';

interface SaveTemplateModalProps {
  isOpen: boolean;
  /** Pre-fills the name field — typically the current program's name so the
   *  coach can save "as is" with one click, or tweak before committing. */
  initialName?: string;
  onClose: () => void;
  onSave: (name: string, description: string) => Promise<void>;
}

/**
 * Compact "Save as Template" capture modal. Surfaces the smallest possible
 * input set — name (required) and description (optional, free-form) — and
 * defers all heavy lifting to the parent's `onSave` handler.
 *
 * Save is gated on a non-empty trimmed name so the empty/whitespace cases
 * don't reach the server (the underlying `program_templates.name` column
 * has a NOT NULL constraint and matching app-side check).
 */
export function SaveTemplateModal({
  isOpen,
  initialName = '',
  onClose,
  onSave,
}: SaveTemplateModalProps) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset on each fresh open. Prefilling from initialName lets the coach
  // accept "Hypertrophy Block 1" with one Save click; clearing on close
  // ensures no stale state leaks into the next session.
  useEffect(() => {
    if (isOpen) {
      setName(initialName);
      setDescription('');
      setError(null);
      setSubmitting(false);
    }
  }, [isOpen, initialName]);

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Template name is required.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onSave(trimmed, description);
      onClose();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not save template — try again.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Save as Template">
      <div className="space-y-5" data-testid="save-template-modal">
        <div className="space-y-1.5">
          <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
            Template Name
          </label>
          <div className="field-wrap">
            <TechnicalInput
              value={name}
              onChange={setName}
              placeholder="Hypertrophy Block 1"
              data-testid="save-template-name"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
            Description <span className="text-muted-foreground/60 normal-case">(optional)</span>
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, 300))}
            placeholder="4-week mesocycle, push/pull/legs split, 8-12 reps@RPE 7..."
            rows={3}
            data-testid="save-template-description"
            className="w-full bg-muted/30 border border-border p-3 text-sm font-mono text-foreground outline-none focus:border-muted-foreground resize-none placeholder:text-muted-foreground/60"
          />
          <p className="text-[9px] font-mono text-muted-foreground/60 text-right tabular-nums">
            {description.length} / 300
          </p>
        </div>

        {error && (
          <p className="text-red-500 font-mono text-xs" data-testid="save-template-error">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex-1 py-3 text-xs font-bold uppercase tracking-widest border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting || !name.trim()}
            data-testid="save-template-submit-btn"
            className="btn-press flex-[2] py-3 text-xs font-bold uppercase tracking-widest bg-foreground text-background hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? 'Saving...' : 'Save Template'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
