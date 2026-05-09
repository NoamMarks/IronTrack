import { useState } from 'react';
import { Button } from '../ui';

interface ClientNotesProps {
  clientId: string;
  coachId: string;
}

export function ClientNotes({ clientId, coachId }: ClientNotesProps) {
  const storageKey = `irontrack_notes_${coachId}_${clientId}`;
  const [notes, setNotes] = useState(() => localStorage.getItem(storageKey) ?? '');
  const [draft, setDraft] = useState(() => localStorage.getItem(storageKey) ?? '');
  const [saved, setSaved] = useState(true);

  const handleSave = () => {
    localStorage.setItem(storageKey, draft);
    setNotes(draft);
    setSaved(true);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-primary/60">Coach Notes</p>
        {!saved && (
          <Button variant="primary" size="sm" onClick={handleSave}>Save</Button>
        )}
        {saved && notes && (
          <span className="text-[9px] font-mono text-accent/60 uppercase tracking-widest">Saved</span>
        )}
      </div>
      <textarea
        value={draft}
        onChange={e => { setDraft(e.target.value); setSaved(e.target.value === notes); }}
        placeholder="Injury history, goals, preferences, anything relevant..."
        rows={5}
        className="w-full bg-surface border border-border/40 focus:border-primary/50 p-3 font-mono text-xs text-foreground outline-none resize-none placeholder:text-muted-foreground/40 transition-colors"
      />
      <p className="text-[9px] font-mono text-muted-foreground/40">Visible to coaches only. Stored locally on this device.</p>
    </div>
  );
}
