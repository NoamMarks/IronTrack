import { useEffect, useState } from 'react';
import { Button } from '../ui';
import { supabase } from '../../lib/supabase';

interface BodyWeightLogProps {
  clientId: string;
}

interface WeightEntry {
  id: string;
  weight_kg: number;
  logged_at: string;
}

export function BodyWeightLog({ clientId }: BodyWeightLogProps) {
  const [entries, setEntries] = useState<WeightEntry[]>([]);
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const sinceIso = since.toISOString().slice(0, 10);
    void supabase
      .from('body_weight_log')
      .select('id, weight_kg, logged_at')
      .eq('client_id', clientId)
      .gte('logged_at', sinceIso)
      .order('logged_at', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error('[IronTrack] body_weight_log fetch failed', error);
          return;
        }
        if (data) setEntries(data as WeightEntry[]);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const handleLog = async () => {
    const w = parseFloat(input);
    if (!w || w <= 0) return;
    setSaving(true);
    const { data } = await supabase
      .from('body_weight_log')
      .upsert(
        {
          client_id: clientId,
          weight_kg: w,
          logged_at: new Date().toISOString().slice(0, 10),
        },
        { onConflict: 'client_id,logged_at' },
      )
      .select()
      .single();
    if (data) {
      const entry = data as WeightEntry;
      setEntries((prev) => [entry, ...prev.filter((e) => e.logged_at !== entry.logged_at)]);
    }
    setInput('');
    setSaving(false);
  };

  return (
    <div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 flex-1 bg-surface border-b border-primary/30 px-3 py-2">
          <input
            type="text"
            inputMode="decimal"
            value={input}
            onChange={(e) => setInput(e.target.value.replace(/[^0-9.]/g, ''))}
            placeholder="Today's weight (kg)"
            data-testid="bodyweight-input"
            className="bg-transparent outline-none font-mono text-sm text-foreground placeholder:text-muted-foreground/40 flex-1"
          />
          <span className="text-[10px] font-mono text-muted-foreground uppercase">kg</span>
        </div>
        <Button
          variant="primary"
          size="sm"
          disabled={!input || saving}
          onClick={() => void handleLog()}
          data-testid="bodyweight-log-btn"
        >
          {saving ? 'Logging…' : 'Log'}
        </Button>
      </div>
      <div className="space-y-1 mt-3">
        {entries.slice(0, 7).map((e) => (
          <div
            key={e.id}
            data-testid={`bodyweight-entry-${e.id}`}
            className="flex justify-between text-[11px] font-mono border-b border-border/20 py-1"
          >
            <span className="text-muted-foreground">{e.logged_at}</span>
            <span className="text-primary font-bold tabular-nums">{e.weight_kg} kg</span>
          </div>
        ))}
        {entries.length === 0 && (
          <p className="text-[10px] font-mono text-muted-foreground/50 text-center py-3">
            No entries yet
          </p>
        )}
      </div>
    </div>
  );
}
