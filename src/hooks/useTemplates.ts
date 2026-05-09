import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Program, ProgramColumn, WorkoutWeek } from '../types';

// =============================================================================
// useTemplates — Coach Template Library CRUD
// =============================================================================
//
// Persists reusable program shells (columns + weeks → days → exercises) to
// the public.program_templates table. RLS scopes all queries to the calling
// coach (auth.uid() = coach_id) so this hook does not filter by coach_id —
// the database does it for us, and a misconfigured policy would surface as
// an empty result set rather than silent leakage.
//
// API surface:
//   templates           — newest-first ProgramTemplate[]
//   isLoading           — true until the first fetch resolves
//   error               — last fetch error, or null
//   saveTemplate(...)   — INSERT a new template from a live Program
//   deleteTemplate(id)  — DELETE one template
//   refresh()           — re-pull all templates (post-mutation safety net)
//
// Why no api/create-template.ts:
//   Saving a template is a single INSERT into one table. RLS enforces auth
//   (coach_id = auth.uid()), no service-role privileges are needed, and
//   there's no cross-table coordination. A serverless function would be
//   pure overhead — direct supabase.from() is the right boundary here.
// =============================================================================

export interface ProgramTemplate {
  id: string;
  name: string;
  description?: string;
  columns: ProgramColumn[];
  weeks: WorkoutWeek[];
  createdAt: string;
}

interface ProgramTemplateRow {
  id: string;
  coach_id: string;
  name: string;
  description: string | null;
  program_data: { columns: ProgramColumn[]; weeks: WorkoutWeek[] };
  created_at: string;
}

function rowToTemplate(r: ProgramTemplateRow): ProgramTemplate {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? undefined,
    columns: r.program_data?.columns ?? [],
    weeks: r.program_data?.weeks ?? [],
    createdAt: r.created_at,
  };
}

/**
 * Snapshot a live Program into the JSONB shape we persist. Strips
 * instance-only fields (id, tenantId, status, archivedAt, createdAt, name)
 * — those are reassigned when the template is later materialised into a
 * fresh `programs` row. The structural columns + weeks tree (with each
 * day's exercises and any logged actuals) is preserved as-is so the
 * coach's shaping is a faithful clone on instantiation.
 *
 * Note: ids on weeks/days/exercises are kept in the snapshot rather than
 * stripped here. The materialisation step (a future helper, out of scope
 * for this hook) is responsible for regenerating them with crypto.randomUUID
 * so the cloned program doesn't share row keys with anything in the DB.
 */
function snapshotProgram(program: Program): { columns: ProgramColumn[]; weeks: WorkoutWeek[] } {
  return {
    columns: program.columns ?? [],
    weeks: program.weeks ?? [],
  };
}

export interface UseTemplatesReturn {
  templates: ProgramTemplate[];
  isLoading: boolean;
  error: Error | null;
  saveTemplate: (name: string, program: Program, description?: string) => Promise<ProgramTemplate>;
  editTemplate: (id: string, name: string, description: string) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useTemplates(): UseTemplatesReturn {
  const [templates, setTemplates] = useState<ProgramTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { data, error: fetchErr } = await supabase
        .from('program_templates')
        .select('id, coach_id, name, description, program_data, created_at')
        .order('created_at', { ascending: false });
      if (fetchErr) throw fetchErr;
      setTemplates(((data ?? []) as ProgramTemplateRow[]).map(rowToTemplate));
    } catch (err) {
      console.error('[useTemplates] fetch failed', err);
      setError(err instanceof Error ? err : new Error('Failed to load templates.'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const saveTemplate = useCallback(
    async (name: string, program: Program, description?: string): Promise<ProgramTemplate> => {
      const trimmedName = name.trim();
      if (!trimmedName) throw new Error('Template name is required.');

      // Resolve the caller. RLS will reject the insert if coach_id doesn't
      // match auth.uid(), but pulling the user up front lets us provide a
      // clearer error message when no session is active (common during
      // dev with stale tabs).
      const { data: { user }, error: userErr } = await supabase.auth.getUser();
      if (userErr || !user) {
        throw new Error('You must be signed in to save a template.');
      }

      const { data, error: insertErr } = await supabase
        .from('program_templates')
        .insert({
          coach_id: user.id,
          name: trimmedName,
          description: description?.trim() || null,
          program_data: snapshotProgram(program),
        })
        .select('id, coach_id, name, description, program_data, created_at')
        .single<ProgramTemplateRow>();

      if (insertErr || !data) {
        console.error('[useTemplates] saveTemplate failed', insertErr);
        throw new Error(insertErr?.message ?? 'Failed to save template.');
      }

      const created = rowToTemplate(data);
      // Optimistic prepend — newest first matches the fetchAll ordering so
      // the freshly-saved template renders at the top without a refetch.
      setTemplates((prev) => [created, ...prev]);
      return created;
    },
    [],
  );

  const editTemplate = useCallback(
    async (id: string, name: string, description: string): Promise<void> => {
      const trimmedName = name.trim();
      if (!trimmedName) return;
      const trimmedDesc = description.trim();
      const { error: updateErr } = await supabase
        .from('program_templates')
        .update({ name: trimmedName, description: trimmedDesc || null })
        .eq('id', id);
      if (updateErr) {
        console.error('[useTemplates] editTemplate failed', updateErr);
        throw new Error(updateErr.message);
      }
      setTemplates((prev) =>
        prev.map((t) =>
          t.id === id
            ? { ...t, name: trimmedName, description: trimmedDesc || '' }
            : t,
        ),
      );
    },
    [],
  );

  const deleteTemplate = useCallback(async (id: string): Promise<void> => {
    const { error: deleteErr } = await supabase
      .from('program_templates')
      .delete()
      .eq('id', id);
    if (deleteErr) {
      console.error('[useTemplates] deleteTemplate failed', deleteErr);
      throw new Error(deleteErr.message);
    }
    setTemplates((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return {
    templates,
    isLoading,
    error,
    saveTemplate,
    editTemplate,
    deleteTemplate,
    refresh: fetchAll,
  };
}
