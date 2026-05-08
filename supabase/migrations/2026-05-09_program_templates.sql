-- =============================================================================
-- Program templates (Coach Template Library)
-- =============================================================================
--
-- Coaches save reusable program shells (columns + weeks → days → exercises)
-- and instantiate them for new trainees without re-typing the structure.
--
-- Why a sibling table to `programs` (rather than a `programs.is_template`
-- flag): templates have no client, no logged sessions, no archived state,
-- and never participate in the analytics queries that walk programs/weeks/
-- days/exercises. Cohabiting them in `programs` would force every existing
-- query to add `where is_template = false` and would muddy the foreign key
-- (a template is owned by a coach, not assigned to a trainee).
--
-- Why JSONB rather than four normalised template_* sibling tables:
--   1. Templates are read-write as a unit — the coach edits the in-memory
--      tree and saves the whole thing. No partial-row updates.
--   2. The shape is small (a typical program is well under 50 KB JSON).
--   3. Avoids maintaining four parallel sibling tables that would all need
--      identical RLS policies.
--
-- Idempotent ("if not exists" / "or replace") so re-runs in dev environments
-- don't error out.

create table if not exists public.program_templates (
  id              uuid primary key default uuid_generate_v4(),
  coach_id        uuid not null references public.profiles(id) on delete cascade,
  name            text not null,
  description     text,
  -- Snapshot of { columns: ProgramColumn[], weeks: WorkoutWeek[] } from a
  -- live Program. Excludes program-instance fields (id, tenantId, status,
  -- archivedAt) — those are assigned when the template is materialised.
  program_data    jsonb not null,
  created_at      timestamptz not null default now()
);

create index if not exists program_templates_coach_id_idx
  on public.program_templates(coach_id);

alter table public.program_templates enable row level security;

-- ─── RLS ────────────────────────────────────────────────────────────────────
-- A template is private to its owning coach. No tenant-wide sharing — each
-- coach maintains their own library. Superadmin can see/edit anything to
-- mirror the access pattern in the rest of the schema.
--
-- Drop-then-create so re-runs don't error on policy redefinition (Postgres
-- has no "create policy if not exists").

drop policy if exists "program_templates_select" on public.program_templates;
create policy "program_templates_select"
  on public.program_templates for select to authenticated
  using (
    coach_id = auth.uid()
    or public.current_role() = 'superadmin'
  );

drop policy if exists "program_templates_insert" on public.program_templates;
create policy "program_templates_insert"
  on public.program_templates for insert to authenticated
  with check (
    coach_id = auth.uid()
    and (public.current_role() = 'admin' or public.current_role() = 'superadmin')
  );

drop policy if exists "program_templates_update" on public.program_templates;
create policy "program_templates_update"
  on public.program_templates for update to authenticated
  using (coach_id = auth.uid() or public.current_role() = 'superadmin')
  with check (coach_id = auth.uid() or public.current_role() = 'superadmin');

drop policy if exists "program_templates_delete" on public.program_templates;
create policy "program_templates_delete"
  on public.program_templates for delete to authenticated
  using (coach_id = auth.uid() or public.current_role() = 'superadmin');
