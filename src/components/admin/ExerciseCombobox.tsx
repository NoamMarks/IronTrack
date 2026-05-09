import { useState, useRef, useEffect, useMemo } from 'react';
import { Search, BookmarkPlus, ChevronDown, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { TechnicalInput, Button } from '../ui';
import { cn } from '../../lib/utils';
import type { LibraryExercise } from '../../hooks/useExerciseLibrary';

interface ExerciseComboboxProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (name: string, videoUrl?: string) => void;
  onSaveToLibrary: (name: string) => Promise<void>;
  exercises: LibraryExercise[];
  maxLength?: number;
  title?: string;
  className?: string;
}

/**
 * A searchable dropdown for the Program Editor. It allows the coach to
 * select from the global/private exercise library OR type a custom name.
 * 
 * If the typed name isn't in the library, a "Save to Library" shortcut
 * appears to encourage reuse.
 */
export function ExerciseCombobox({
  value,
  onChange,
  onSelect,
  onSaveToLibrary,
  exercises,
  maxLength,
  title,
  className,
}: ExerciseComboboxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>('All');
  const containerRef = useRef<HTMLDivElement>(null);

  // Close helper — reset category filter alongside the dropdown so a stale
  // selection doesn't bleed into the next open. Called from click-outside,
  // option-pick, and any other future close trigger.
  const closeDropdown = () => {
    setIsOpen(false);
    setActiveCategory('All');
  };

  // Close on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closeDropdown();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Distinct categories present in the loaded exercises, alphabetised, with
  // an 'All' bucket prepended so the default state is "no filter". 'All'
  // sorts to the front naturally because uppercase 'A' precedes any of the
  // lowercase enum values ('accessory' / 'bench' / etc.) in ASCII order.
  const categories = useMemo(
    () => ['All', ...Array.from(new Set(exercises.map((e) => e.category).filter(Boolean)))].sort(),
    [exercises],
  );

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    return exercises.filter((ex) =>
      ex.name.toLowerCase().includes(q)
      && (activeCategory === 'All' || ex.category === activeCategory),
    );
  }, [exercises, value, activeCategory]);

  const exactMatch = useMemo(() => {
    return exercises.find((ex) => ex.name.toLowerCase() === value.trim().toLowerCase());
  }, [exercises, value]);

  const handleSelect = (ex: LibraryExercise) => {
    onSelect(ex.name, ex.videoUrl);
    closeDropdown();
  };

  const handleSave = async () => {
    if (!value.trim() || exactMatch || isSaving) return;
    setIsSaving(true);
    try {
      await onSaveToLibrary(value.trim());
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div ref={containerRef} className="relative w-full group">
      <div className="relative">
        <TechnicalInput
          value={value}
          onChange={(v) => {
            onChange(v);
            if (!isOpen) setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          maxLength={maxLength}
          title={title}
          data-testid="exercise-combobox-input"
          className={cn('pr-10', className)}
          placeholder="Exercise name..."
        />
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronDown className={cn('w-4 h-4 transition-transform', isOpen && 'rotate-180')} />
        </button>
      </div>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="absolute z-50 left-0 right-0 mt-2 bg-card border border-border shadow-2xl rounded-sm overflow-hidden max-h-80 flex flex-col"
          >
            {/* List header */}
            <div className="px-4 py-2 bg-muted/30 border-b border-border flex items-center justify-between">
              <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
                {value.trim() ? `Search: ${value}` : 'Exercise Library'}
              </span>
              <Search className="w-3 h-3 text-muted-foreground/50" />
            </div>

            {/* Category filter — onMouseDown + preventDefault so clicking a
                pill doesn't blur the input and collapse the dropdown before
                the click registers. */}
            {exercises.length > 0 && (
              <div className="flex flex-wrap gap-1 px-2 pt-2 pb-1 border-b border-border/30">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); setActiveCategory(cat); }}
                    data-testid={`exercise-combobox-category-${cat}`}
                    className={cn(
                      'px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest border transition-colors',
                      activeCategory === cat
                        ? 'bg-primary/20 text-primary border-primary/50'
                        : 'border-border/50 text-muted-foreground hover:border-primary/30 hover:text-primary',
                    )}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            )}

            {/* Results */}
            <div className="overflow-y-auto flex-1 custom-scrollbar">
              {filtered.length > 0 ? (
                <ul className="divide-y divide-border/30">
                  {filtered.map((ex) => (
                    <li key={ex.id}>
                      <button
                        type="button"
                        onClick={() => handleSelect(ex)}
                        data-testid={`exercise-combobox-option-${ex.id}`}
                        className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors flex items-center justify-between group/opt"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-foreground truncate">
                            {ex.name}
                          </p>
                          <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest">
                            {ex.isGlobal ? 'Global' : 'Your Library'} · {ex.category}
                          </p>
                        </div>
                        {exactMatch?.id === ex.id && (
                          <Check className="w-4 h-4 text-accent" />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="px-4 py-8 text-center">
                  <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
                    No library matches
                  </p>
                </div>
              )}
            </div>

            {/* "Save to Library" Footer — only if no exact match exists */}
            {value.trim() && !exactMatch && (
              <div className="p-3 bg-muted/10 border-t border-border">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleSave}
                  disabled={isSaving}
                  className="w-full flex items-center justify-center gap-2"
                >
                  {isSaving ? (
                    'Saving...'
                  ) : (
                    <>
                      <BookmarkPlus className="w-3.5 h-3.5" />
                      Save "{value}" to Library
                    </>
                  )}
                </Button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
