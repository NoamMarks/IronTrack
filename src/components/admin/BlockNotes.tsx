import { useState, useEffect } from 'react';
import { Button } from '../ui';
import type { Program } from '../../types';

interface BlockNotesProps {
  program: Program;
  onSave: (notes: string) => Promise<void>;
}

/**
 * Coach-side editor for `program.coachNotes`. Renders a single textarea
 * (1000-char cap) and a Save button that's enabled only when the draft
 * differs from the persisted value — so a coach who clicks into the field
 * and tabs away without changing anything doesn't accidentally fire a write.
 */
export function BlockNotes({ program, onSave }: BlockNotesProps) {
  const [draft, setDraft] = useState(program.coachNotes ?? '');
  const [saving, setSaving] = useState(false);
  const isDirty = draft.trim() !== (program.coachNotes ?? '').trim();

  // Re-sync draft when the program changes (coach switches active block) or
  // when the persisted coachNotes is updated from elsewhere (another tab, a
  // background save). useState initializers only fire on first mount, so
  // without this effect the textarea would keep showing the previous block's
  // notes after the parent passes a new `program` prop. Key on `program.id`
  // (stable across object identity changes) plus `coachNotes` (so an external
  // save flows back in) — NOT the whole `program` object, whose referential
  // equality would thrash on every render.
  useEffect(() => {
    setDraft(program.coachNotes ?? '');
  }, [program.id, program.coachNotes]);

  return (
    <div className="space-y-3 p-4 bg-surface border border-primary/15">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-primary/60">
          Block Notes
        </p>
        <Button
          variant="primary"
          size="sm"
          disabled={!isDirty || saving}
          onClick={async () => {
            setSaving(true);
            try {
              await onSave(draft);
            } finally {
              setSaving(false);
            }
          }}
          data-testid="block-notes-save-btn"
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Explain the goal of this block, methodology, key focus points for the trainee…"
        rows={4}
        maxLength={1000}
        data-testid="block-notes-textarea"
        className="w-full bg-transparent border-b border-primary/30 focus:border-primary p-2 font-mono text-sm text-foreground outline-none resize-none placeholder:text-muted-foreground/30 transition-colors"
      />
      <p className="text-[9px] font-mono text-muted-foreground/40 text-right tabular-nums">
        {draft.length} / 1000
      </p>
    </div>
  );
}
