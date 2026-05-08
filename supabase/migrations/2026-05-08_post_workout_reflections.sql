-- =============================================================================
-- Post-workout reflections
-- =============================================================================
--
-- Adds three columns to `days` so trainees can capture a difficulty rating
-- and a free-text note when they finish a workout, and so coaches can read
-- those notes in real-time on the admin sidebar.
--
--   - difficulty       smallint (1-5, nullable)
--   - reflection_note  text     (nullable, capped at 500 chars in app code)
--   - reflection_at    timestamptz (set when the trainee submits)
--
-- We intentionally do NOT add a separate `reflections` table — a workout
-- day produces at most one reflection, and joining a 1:1 sibling table for
-- two scalar fields is more cost than benefit. The realtime subscription on
-- the coach side fires on `days` UPDATE filtered by reflection_at IS NOT
-- NULL, which is cheaper than a join.
--
-- RLS: existing day-level policies cascade through programs.tenant_id, so
-- a trainee can already update their own day rows and a coach can already
-- read days within their tenant. No new policies required for the columns.
-- The realtime publication, however, is a separate gate — see the bottom
-- of this file.

alter table public.days
  add column if not exists difficulty       smallint
    check (difficulty is null or (difficulty >= 1 and difficulty <= 5)),
  add column if not exists reflection_note  text,
  add column if not exists reflection_at    timestamptz;

-- Coach activity feed reads "the last N reflections in my tenant", so an
-- index on reflection_at descending pays for itself the first time the
-- panel loads.
create index if not exists days_reflection_at_idx
  on public.days (reflection_at desc nulls last)
  where reflection_at is not null;

-- =============================================================================
-- Realtime publication
-- =============================================================================
--
-- Supabase ships a `supabase_realtime` publication that the realtime server
-- subscribes to; only tables in that publication can be observed. Adding
-- `days` here is what makes the coach-side `useRecentActivity` channel
-- light up when a trainee submits a reflection.
--
-- Wrapped in a do-block because `alter publication ... add table` errors
-- if the table is already a member, and we want this migration to be
-- idempotent (re-runs in dev environments are common).

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'days'
  ) then
    alter publication supabase_realtime add table public.days;
  end if;
end
$$;
