-- =============================================================================
-- Exercise Library
-- =============================================================================
--
-- Shared catalogue of named lifts that the Program Editor's exercise picker
-- pulls from. Two row variants live in the same table:
--   • Global rows  — coach_id IS NULL, tenant_id IS NULL. Visible to every
--                    authenticated user. Seeded below; only superadmin can
--                    edit.
--   • Coach rows   — coach_id = the owning coach's profile id, tenant_id
--                    denormalised to the same id. Visible only to that coach
--                    (and superadmin). Each coach maintains their own
--                    additions; tenants do NOT share custom rows in this
--                    initial design.
--
-- Single-table design (rather than `core_exercises` + `coach_exercises`) so
-- the picker issues one query and RLS does the filtering — no UNION, no
-- client-side merge.
--
-- Why a discrete library table (rather than mining `exercises` rows for
-- distinct names):
--   1. Fast lookups: a small list per coach indexed by coach_id is cheap to
--      load on Editor mount; SELECT DISTINCT exercise_name from `exercises`
--      walks the entire program history every time.
--   2. Persistence beyond programs: archived/deleted programs would erase
--      a name from the suggestion pool — coaches expect their library to
--      survive a roster cleanup.
--   3. video_url, category, future fields (cues, default RPE, muscle group)
--      live in one canonical row per exercise rather than scattered across
--      every instantiation.
--
-- Idempotent — `if not exists`, `add column if not exists`, drop-then-create
-- policies — so re-runs in dev environments are safe.

-- ─── Enum ───────────────────────────────────────────────────────────────────

do $$ begin
  create type exercise_category as enum ('squat', 'bench', 'deadlift', 'accessory');
exception when duplicate_object then null; end $$;

-- ─── Table ──────────────────────────────────────────────────────────────────

create table if not exists public.exercise_library (
  id          uuid primary key default uuid_generate_v4(),
  -- Both nullable: globals carry NULL/NULL, coach additions carry their own
  -- coach_id and (denormalised) tenant_id so a future tenant-shared library
  -- mode can SELECT without joining profiles.
  tenant_id   uuid references public.profiles(id) on delete cascade,
  coach_id    uuid references public.profiles(id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  category    exercise_category not null default 'accessory',
  video_url   text,
  created_at  timestamptz not null default now()
);

-- Migration safety: an earlier draft of this table shipped without
-- tenant_id / category and with NOT NULL coach_id. Bring any pre-existing
-- table into the new shape rather than forcing a manual drop+recreate.
alter table public.exercise_library
  add column if not exists tenant_id uuid references public.profiles(id) on delete cascade;
alter table public.exercise_library
  add column if not exists category exercise_category not null default 'accessory';
alter table public.exercise_library alter column coach_id drop not null;

-- ─── Indexes ────────────────────────────────────────────────────────────────
-- Listing query: coach_id with newest-first ordering → coach_id index.
-- Category filter: category index for the picker's tab filter.
-- Dedupe: two partial unique indexes because NULL ≠ NULL in unique
-- constraints, so we can't use a single (coach_id, lower(name)) index to
-- cover both globals and coach rows.

create index if not exists exercise_library_coach_id_idx
  on public.exercise_library(coach_id);

create index if not exists exercise_library_category_idx
  on public.exercise_library(category);

-- Old non-partial unique index from the earlier draft, replaced by the
-- partial pair below. Drop is no-op when the table is fresh.
drop index if exists public.exercise_library_coach_lower_name_uniq;

create unique index if not exists exercise_library_coach_uniq_idx
  on public.exercise_library(coach_id, lower(name))
  where coach_id is not null;

create unique index if not exists exercise_library_global_uniq_idx
  on public.exercise_library(lower(name))
  where coach_id is null;

alter table public.exercise_library enable row level security;

-- ─── RLS ────────────────────────────────────────────────────────────────────
-- SELECT: every authenticated user sees globals + their own additions.
-- Superadmin sees everything (mirrors the rest of the schema).
-- INSERT: a coach inserts their own row (coach_id = auth.uid()); only
-- superadmin can insert globals (coach_id IS NULL).
-- UPDATE/DELETE: owner-only (or superadmin).

drop policy if exists "exercise_library_select" on public.exercise_library;
create policy "exercise_library_select"
  on public.exercise_library for select to authenticated
  using (
    coach_id is null
    or coach_id = auth.uid()
    or public.current_role() = 'superadmin'
  );

drop policy if exists "exercise_library_insert" on public.exercise_library;
create policy "exercise_library_insert"
  on public.exercise_library for insert to authenticated
  with check (
    (coach_id = auth.uid()
      and (public.current_role() = 'admin' or public.current_role() = 'superadmin'))
    or (coach_id is null and public.current_role() = 'superadmin')
  );

drop policy if exists "exercise_library_update" on public.exercise_library;
create policy "exercise_library_update"
  on public.exercise_library for update to authenticated
  using (coach_id = auth.uid() or public.current_role() = 'superadmin')
  with check (coach_id = auth.uid() or public.current_role() = 'superadmin');

drop policy if exists "exercise_library_delete" on public.exercise_library;
create policy "exercise_library_delete"
  on public.exercise_library for delete to authenticated
  using (coach_id = auth.uid() or public.current_role() = 'superadmin');

-- ─── Seed: 10 core movements ────────────────────────────────────────────────
-- Placeholder video_url values point at credible technique resources
-- (Squat University and Juggernaut Training Systems channel pages). The
-- coach (or a future content-curation pass) should replace these with the
-- specific videos they want their trainees to watch.
--
-- Wrapped in a DO block + existence check so re-running the migration
-- never duplicates the seed rows. The partial unique index on
-- lower(name) where coach_id is null would also catch dupes, but the
-- existence guard skips the work entirely in the common re-run case.

do $$
begin
  if not exists (select 1 from public.exercise_library where coach_id is null) then
    insert into public.exercise_library (tenant_id, coach_id, name, category, video_url)
    values
      (null, null, 'Low Bar Back Squat',      'squat',     'https://www.youtube.com/@squatuniversity'),
      (null, null, 'High Bar Back Squat',     'squat',     'https://www.youtube.com/@squatuniversity'),
      (null, null, 'Front Squat',             'squat',     'https://www.youtube.com/@squatuniversity'),
      (null, null, 'Competition Bench Press', 'bench',     'https://www.youtube.com/@JuggernautTrainingSystems'),
      (null, null, 'Close-Grip Bench Press',  'bench',     'https://www.youtube.com/@JuggernautTrainingSystems'),
      (null, null, 'Incline Bench Press',     'bench',     'https://www.youtube.com/@JuggernautTrainingSystems'),
      (null, null, 'Conventional Deadlift',   'deadlift',  'https://www.youtube.com/@JuggernautTrainingSystems'),
      (null, null, 'Sumo Deadlift',           'deadlift',  'https://www.youtube.com/@JuggernautTrainingSystems'),
      (null, null, 'Romanian Deadlift',       'accessory', 'https://www.youtube.com/@JuggernautTrainingSystems'),
      (null, null, 'Overhead Press',          'accessory', 'https://www.youtube.com/@JuggernautTrainingSystems');
  end if;
end
$$;
