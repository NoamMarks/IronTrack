import { useState, useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { Users, Dumbbell, Layout, ShieldCheck, type LucideIcon } from 'lucide-react';
import { cn } from '../lib/utils';
import type { Client } from '../types';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  clients: Client[];
  onSelectClient: (c: Client) => void;
  onGoSuperadmin?: () => void;
  onGoCoach?: () => void;
}

type ItemType = 'CLIENT' | 'EXERCISE' | 'ACTION';

interface CommandItem {
  id: string;
  type: ItemType;
  label: string;
  subtitle?: string;
  icon: LucideIcon;
  searchable: string;
  action: () => void;
}

const RECENT_KEY = 'irontrack_command_recent';
const MAX_RESULTS = 8;
const MAX_RECENT = 5;
const GROUP_ORDER: ItemType[] = ['CLIENT', 'EXERCISE', 'ACTION'];

function loadRecentIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

function saveRecentIds(ids: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(ids));
  } catch {
    /* localStorage quota / disabled — recent list simply doesn't persist */
  }
}

function scoreItem(searchable: string, query: string): number {
  const s = searchable.toLowerCase();
  const q = query.toLowerCase();
  if (!s.includes(q)) return 0;
  return s.startsWith(q) ? 2 : 1;
}

export function CommandPalette({
  isOpen,
  onClose,
  clients,
  onSelectClient,
  onGoSuperadmin,
  onGoCoach,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const [recentIds, setRecentIds] = useState<string[]>(() => loadRecentIds());
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset on each open + autofocus the input
  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setHighlighted(0);
    setRecentIds(loadRecentIds());
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [isOpen]);

  // Reset highlight as the user types
  useEffect(() => {
    setHighlighted(0);
  }, [query]);

  const allItems = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [];

    for (const c of clients) {
      items.push({
        id: `CLIENT:${c.id}`,
        type: 'CLIENT',
        label: c.name,
        subtitle: c.email,
        icon: Users,
        searchable: `${c.name} ${c.email}`,
        action: () => onSelectClient(c),
      });
    }

    const seenExercises = new Set<string>();
    for (const c of clients) {
      for (const p of c.programs) {
        for (const w of p.weeks) {
          for (const d of w.days) {
            for (const ex of d.exercises) {
              if (!ex.exerciseName) continue;
              const key = ex.exerciseName.toLowerCase();
              if (seenExercises.has(key)) continue;
              seenExercises.add(key);
              items.push({
                id: `EXERCISE:${key}`,
                type: 'EXERCISE',
                label: ex.exerciseName,
                icon: Dumbbell,
                searchable: ex.exerciseName,
                // Exercises aren't a navigable destination yet — selecting one
                // just promotes it in the recent list so it surfaces faster.
                action: () => undefined,
              });
            }
          }
        }
      }
    }

    if (onGoCoach) {
      items.push({
        id: 'ACTION:gocoach',
        type: 'ACTION',
        label: 'Go to Coach Dashboard',
        icon: Layout,
        searchable: 'Go to Coach Dashboard',
        action: onGoCoach,
      });
    }
    if (onGoSuperadmin) {
      items.push({
        id: 'ACTION:gosuperadmin',
        type: 'ACTION',
        label: 'Go to Superadmin',
        icon: ShieldCheck,
        searchable: 'Go to Superadmin',
        action: onGoSuperadmin,
      });
    }

    return items;
  }, [clients, onSelectClient, onGoCoach, onGoSuperadmin]);

  const visibleItems = useMemo<CommandItem[]>(() => {
    if (!query.trim()) {
      const byId = new Map(allItems.map((it) => [it.id, it]));
      return recentIds
        .map((id) => byId.get(id))
        .filter((it): it is CommandItem => !!it)
        .slice(0, MAX_RECENT);
    }
    return allItems
      .map((it) => ({ it, score: scoreItem(it.searchable, query) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS)
      .map((x) => x.it);
  }, [query, allItems, recentIds]);

  const groups = useMemo<{ heading: string; items: CommandItem[] }[]>(() => {
    if (!query.trim()) {
      return visibleItems.length > 0
        ? [{ heading: 'RECENT', items: visibleItems }]
        : [];
    }
    return GROUP_ORDER.map((type) => ({
      heading: type,
      items: visibleItems.filter((it) => it.type === type),
    })).filter((g) => g.items.length > 0);
  }, [visibleItems, query]);

  const handleSelect = (item: CommandItem) => {
    const next = [item.id, ...recentIds.filter((id) => id !== item.id)].slice(0, MAX_RECENT);
    saveRecentIds(next);
    setRecentIds(next);
    item.action();
    onClose();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (visibleItems.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, visibleItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const it = visibleItems[highlighted];
      if (it) handleSelect(it);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh]">
      <div
        onClick={onClose}
        className="absolute inset-0 bg-background/80 backdrop-blur-md"
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-label="Command palette"
        data-testid="command-palette"
        className="relative w-full max-w-xl mx-4 bg-surface border border-primary/30 shadow-2xl shadow-primary/20"
      >
        <span className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-primary/70 pointer-events-none" />
        <span className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-primary/70 pointer-events-none" />
        <span className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 border-primary/70 pointer-events-none" />
        <span className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-primary/70 pointer-events-none" />

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search clients, exercises, actions..."
          data-testid="command-palette-input"
          className="bg-transparent border-b border-primary/30 focus:border-primary p-4 font-mono text-base text-foreground outline-none w-full"
        />

        <div className="max-h-[60vh] overflow-y-auto">
          {groups.length === 0 && (
            <p className="px-4 py-6 text-center text-[10px] font-mono text-muted-foreground/50">
              {query.trim() ? 'No results' : 'No recent items'}
            </p>
          )}
          {groups.map((g) => (
            <div key={g.heading}>
              <p className="px-4 pt-3 pb-1 text-[9px] font-mono uppercase tracking-widest text-muted-foreground/60">
                {g.heading}
              </p>
              {g.items.map((it) => {
                const flatIndex = visibleItems.indexOf(it);
                const isHighlighted = flatIndex === highlighted;
                const Icon = it.icon;
                return (
                  <button
                    key={it.id}
                    onClick={() => handleSelect(it)}
                    onMouseEnter={() => setHighlighted(flatIndex)}
                    data-testid={`command-palette-item-${it.id}`}
                    className={cn(
                      'w-full flex items-center gap-3 px-4 py-3 transition-colors text-left',
                      isHighlighted
                        ? 'bg-primary/10 border-l-2 border-primary'
                        : 'border-l-2 border-transparent hover:bg-surface/60',
                    )}
                  >
                    <Icon
                      className={cn(
                        'w-4 h-4',
                        isHighlighted ? 'text-primary' : 'text-muted-foreground',
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <p
                        className={cn(
                          'font-display font-semibold uppercase tracking-wide text-sm truncate',
                          isHighlighted ? 'text-primary' : 'text-foreground',
                        )}
                      >
                        {it.label}
                      </p>
                      {it.subtitle && (
                        <p className="font-mono text-[10px] text-muted-foreground truncate">
                          {it.subtitle}
                        </p>
                      )}
                    </div>
                    <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground/50">
                      {it.type}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="border-t border-primary/15 px-4 py-2 font-mono text-[10px] text-muted-foreground/50">
          ↑↓ navigate · ↵ select · esc close
        </div>
      </div>
    </div>
  );
}
