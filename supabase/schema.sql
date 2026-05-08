-- =============================================================================
-- IronTrack v0.2.0 → Supabase Schema (Phase 1)
-- =============================================================================
--
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- Idempotent-ish: drops and recreates types/policies but uses CREATE TABLE
-- without IF NOT EXISTS so a re-run on a populated database WILL fail until
-- the tables are dropped. Treat this as the canonical source of the schema
-- for the initial cutover, not as a migration script.
--
-- Mapping from src/types.ts:
--
--   Client                          → public.profiles  (1 row per user; password
--                                                       removed — handled by
--                                                       Supabase auth.users)
--   InviteCode                      → public.invite_codes
--   Program                         → public.programs
--   Program.columns                 → JSONB on programs (small, dynamic, ordered)
--   WorkoutWeek                     → public.weeks
--   WorkoutDay                      → public.days
--   ExercisePlan                    → public.exercises
--   ExercisePlan.values             → JSONB on exercises (custom column data)
--
-- Tenant model (preserved from the localStorage architecture):
--
--   superadmin  → tenant_id IS NULL   (sees everything)
--   admin/coach → tenant_id = own id  (own tenant root)
--   trainee     → tenant_id = coach's id (inherited at signup)
--
-- =============================================================================

-- ─── Extensions ──────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ─── Enums ───────────────────────────────────────────────────────────────────
do $$ begin
  create type user_role as enum ('superadmin', 'admin', 'trainee');
exception when duplicate_object then null; end $$;

do $$ begin
  create type program_status as enum ('active', 'archived');
exception when duplicate_object then null; end $$;

-- ─── profiles ────────────────────────────────────────────────────────────────
-- Mirrors auth.users 1-to-1; carries IronTrack-specific user data + tenant.
create table public.profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  name                text not null,
  email               text not null unique,
  role                user_role not null default 'trainee',
  -- Self-referencing tenant: own id for coaches, coach's id for trainees,
  -- NULL for superadmin. ON DELETE SET NULL so deleting a coach orphans their
  -- trainees instead of cascading the wipe.
  tenant_id           uuid references public.profiles(id) on delete set null,
  -- The trainee's currently-active program (FK is added AFTER programs is
  -- created below, since we need a forward reference).
  active_program_id   uuid,
  created_at          timestamptz not null default now()
);

create index profiles_tenant_id_idx on public.profiles(tenant_id);
create index profiles_role_idx      on public.profiles(role);

-- ─── invite_codes ────────────────────────────────────────────────────────────
create table public.invite_codes (
  id           uuid primary key default uuid_generate_v4(),
  code         text not null unique,
  coach_id     uuid not null references public.profiles(id) on delete cascade,
  -- Tenant the code belongs to. For coaches this equals coach_id; pre-stored
  -- so the signup flow can resolve a tenant without a second profile lookup.
  tenant_id    uuid not null references public.profiles(id) on delete cascade,
  coach_name   text,
  -- Use cap. NULL means unlimited (per Sprint 5 semantics: null/0 = unlimited).
  max_uses     int,
  use_count    int not null default 0,
  created_at   timestamptz not null default now()
);

create index invite_codes_code_idx     on public.invite_codes(code);
create index invite_codes_coach_id_idx on public.invite_codes(coach_id);

-- ─── program_templates ───────────────────────────────────────────────────────
-- Coach Template Library. Reusable program shells, owned by the coach who
-- created them, materialised into a live `programs` row when assigned to a
-- trainee. JSONB snapshot rather than normalised sibling tables — see the
-- 2026-05-09_program_templates migration for the rationale.
create table public.program_templates (
  id              uuid primary key default uuid_generate_v4(),
  coach_id        uuid not null references public.profiles(id) on delete cascade,
  name            text not null,
  description     text,
  -- { columns: ProgramColumn[], weeks: WorkoutWeek[] } — see snapshotProgram
  -- in src/hooks/useTemplates.ts for the exact shape.
  program_data    jsonb not null,
  created_at      timestamptz not null default now()
);

create index program_templates_coach_id_idx on public.program_templates(coach_id);

-- ─── exercise_library ────────────────────────────────────────────────────────
-- Shared catalogue of named lifts that the Program Editor's exercise picker
-- pulls from. Two row variants live in the same table:
--   • Global rows  — coach_id IS NULL, tenant_id IS NULL. Visible to every
--                    authenticated user. Seeded with 10 core lifts.
--   • Coach rows   — coach_id = the owning coach's profile id. Visible only
--                    to that coach (and superadmin). Each coach maintains
--                    their own additions; tenants do NOT share custom rows
--                    in this initial design.
-- See 2026-05-09_exercise_library migration for the rationale + seed.
do $$ begin
  create type exercise_category as enum ('squat', 'bench', 'deadlift', 'accessory');
exception when duplicate_object then null; end $$;

create table public.exercise_library (
  id          uuid primary key default uuid_generate_v4(),
  -- Both nullable: globals carry NULL/NULL, coach additions carry their own
  -- coach_id and (denormalised) tenant_id.
  tenant_id   uuid references public.profiles(id) on delete cascade,
  coach_id    uuid references public.profiles(id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  category    exercise_category not null default 'accessory',
  video_url   text,
  created_at  timestamptz not null default now()
);

create index exercise_library_coach_id_idx on public.exercise_library(coach_id);
create index exercise_library_category_idx on public.exercise_library(category);

-- Two partial unique indexes — NULL ≠ NULL in UNIQUE, so we can't dedupe
-- both row variants with a single index.
create unique index exercise_library_coach_uniq_idx
  on public.exercise_library(coach_id, lower(name))
  where coach_id is not null;
create unique index exercise_library_global_uniq_idx
  on public.exercise_library(lower(name))
  where coach_id is null;

-- ─── programs ────────────────────────────────────────────────────────────────
create table public.programs (
  id            uuid primary key default uuid_generate_v4(),
  client_id     uuid not null references public.profiles(id) on delete cascade,
  -- Denormalised tenant_id so authorization queries don't require a join up
  -- through profiles. App layer keeps it in sync with client.tenant_id.
  tenant_id     uuid references public.profiles(id) on delete set null,
  name          text not null,
  -- ProgramColumn[] — small, dynamic, ordered. JSONB preserves the array
  -- order naturally and avoids a 4th level of normalised tables for the
  -- "Plan/Actual" toggles that the coach edits frequently.
  columns       jsonb not null default '[]'::jsonb,
  status        program_status not null default 'active',
  archived_at   timestamptz,
  created_at    timestamptz not null default now()
);

create index programs_client_id_idx on public.programs(client_id);
create index programs_tenant_id_idx on public.programs(tenant_id);
create index programs_status_idx    on public.programs(status);

-- Wire the forward reference now that programs exists.
alter table public.profiles
  add constraint profiles_active_program_fk
  foreign key (active_program_id)
  references public.programs(id)
  on delete set null;

-- ─── weeks ───────────────────────────────────────────────────────────────────
create table public.weeks (
  id           uuid primary key default uuid_generate_v4(),
  program_id   uuid not null references public.programs(id) on delete cascade,
  week_number  int  not null check (week_number >= 1),
  created_at   timestamptz not null default now(),
  unique (program_id, week_number)
);

create index weeks_program_id_idx on public.weeks(program_id);

-- ─── days ────────────────────────────────────────────────────────────────────
create table public.days (
  id               uuid primary key default uuid_generate_v4(),
  week_id          uuid not null references public.weeks(id) on delete cascade,
  day_number       int  not null check (day_number >= 1),
  name             text not null default 'New Workout',
  -- Set when the trainee saves the session for this day. Null = unlogged.
  logged_at        timestamptz,
  -- Post-workout reflection: 1-5 difficulty + free-text note. Null until the
  -- trainee submits the reflection modal; nullable so existing logged days
  -- aren't retroactively required to have one.
  difficulty       smallint check (difficulty is null or (difficulty >= 1 and difficulty <= 5)),
  reflection_note  text,
  reflection_at    timestamptz,
  created_at       timestamptz not null default now()
);

create index days_week_id_idx on public.days(week_id);
create index days_reflection_at_idx
  on public.days (reflection_at desc nulls last)
  where reflection_at is not null;

-- ─── exercises ───────────────────────────────────────────────────────────────
create table public.exercises (
  id            uuid primary key default uuid_generate_v4(),
  day_id        uuid not null references public.days(id) on delete cascade,
  -- Position within the day. The frontend uses array order; we materialise
  -- that here so SELECTs can ORDER BY position without surprise.
  position      int  not null default 0,
  exercise_id   text not null,
  exercise_name text not null,
  sets          int,
  reps          text,
  expected_rpe  text,
  weight_range  text,
  actual_load   text,
  actual_rpe    text,
  notes         text,
  video_url     text,
  -- Coach-defined custom column values, keyed by ProgramColumn.id. JSONB so
  -- adding/removing custom columns doesn't require a schema migration.
  values        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index exercises_day_id_idx       on public.exercises(day_id);
create index exercises_day_position_idx on public.exercises(day_id, position);

-- =============================================================================
-- Row Level Security
-- =============================================================================
--
-- Helper functions inspect the caller's profile WITHOUT triggering its own RLS
-- check (security definer). Policies then call these helpers to enforce
-- tenant scoping uniformly across all tables.

create or replace function public.current_role()
returns user_role
language sql stable security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.current_tenant_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select tenant_id from public.profiles where id = auth.uid();
$$;

alter table public.profiles           enable row level security;
alter table public.invite_codes       enable row level security;
alter table public.program_templates  enable row level security;
alter table public.exercise_library   enable row level security;
alter table public.programs           enable row level security;
alter table public.weeks              enable row level security;
alter table public.days               enable row level security;
alter table public.exercises          enable row level security;

-- ─── profiles ────────────────────────────────────────────────────────────────
-- A user can read their own profile + everyone in their tenant. Superadmin
-- reads all.
create policy "profiles_select"
  on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or tenant_id = public.current_tenant_id()
    or public.current_role() = 'superadmin'
  );

-- A user can update their own profile. Coaches can update profiles in their
-- tenant. Superadmin can update anyone.
create policy "profiles_update"
  on public.profiles for update to authenticated
  using (
    id = auth.uid()
    or (public.current_role() = 'admin' and tenant_id = public.current_tenant_id())
    or public.current_role() = 'superadmin'
  );

-- INSERT into profiles is normally driven by the auth trigger (see below).
-- Allowing authenticated insert here covers the case where the trigger is
-- bypassed (e.g. SSR / server-side admin scripts).
create policy "profiles_insert"
  on public.profiles for insert to authenticated
  with check (auth.uid() is not null);

create policy "profiles_delete"
  on public.profiles for delete to authenticated
  using (
    public.current_role() = 'superadmin'
    or (public.current_role() = 'admin' and tenant_id = public.current_tenant_id())
  );

-- ─── invite_codes ────────────────────────────────────────────────────────────
-- Coach reads/manages their own. Anonymous read-by-code is needed for the
-- unauthenticated signup flow (the user enters a code BEFORE authenticating).
-- We allow anon SELECT and rely on the secret/random nature of the code itself.
create policy "invite_codes_select_authenticated"
  on public.invite_codes for select to authenticated
  using (
    coach_id = auth.uid()
    or public.current_role() = 'superadmin'
  );

create policy "invite_codes_select_anon_lookup"
  on public.invite_codes for select to anon
  using (true);

create policy "invite_codes_insert"
  on public.invite_codes for insert to authenticated
  with check (
    coach_id = auth.uid()
    and (public.current_role() = 'admin' or public.current_role() = 'superadmin')
  );

create policy "invite_codes_update_own"
  on public.invite_codes for update to authenticated
  using (coach_id = auth.uid() or public.current_role() = 'superadmin');

create policy "invite_codes_delete_own"
  on public.invite_codes for delete to authenticated
  using (coach_id = auth.uid() or public.current_role() = 'superadmin');

-- ─── programs ────────────────────────────────────────────────────────────────
create policy "programs_select"
  on public.programs for select to authenticated
  using (
    client_id = auth.uid()
    or tenant_id = public.current_tenant_id()
    or public.current_role() = 'superadmin'
  );

-- INSERT: ONLY coaches (admin) and superadmins. Without this role gate
-- a trainee whose tenant_id is set to their coach's id could create
-- arbitrary programs in the tenant — a privilege-escalation vector
-- caught by the RLS pen-test suite (security-rls.spec.ts).
create policy "programs_insert"
  on public.programs for insert to authenticated
  with check (
    (public.current_role() = 'admin' and tenant_id = public.current_tenant_id())
    or public.current_role() = 'superadmin'
  );

-- UPDATE: coaches can edit programs in their tenant; superadmins can edit
-- anything. Trainees do NOT update the programs table directly — their
-- save-session writes land on `days.logged_at` and `exercises.actual_*`
-- which have their own policies that explicitly allow trainee writes.
create policy "programs_update"
  on public.programs for update to authenticated
  using (
    (public.current_role() = 'admin' and tenant_id = public.current_tenant_id())
    or public.current_role() = 'superadmin'
  );

create policy "programs_delete"
  on public.programs for delete to authenticated
  using (
    (public.current_role() = 'admin' and tenant_id = public.current_tenant_id())
    or public.current_role() = 'superadmin'
  );

-- ─── weeks / days / exercises ────────────────────────────────────────────────
-- Authorisation cascades through programs.tenant_id. Each policy joins up to
-- the program to evaluate access. The CHECK clauses repeat the same join so
-- inserts/updates require the user is allowed to write to the parent program.

create policy "weeks_all"
  on public.weeks for all to authenticated
  using (exists (
    select 1 from public.programs p
    where p.id = weeks.program_id
      and (
        p.client_id = auth.uid()
        or p.tenant_id = public.current_tenant_id()
        or public.current_role() = 'superadmin'
      )
  ))
  with check (exists (
    select 1 from public.programs p
    where p.id = weeks.program_id
      and (
        p.tenant_id = public.current_tenant_id()
        or public.current_role() = 'superadmin'
      )
  ));

create policy "days_all"
  on public.days for all to authenticated
  using (exists (
    select 1
    from public.weeks w
    join public.programs p on p.id = w.program_id
    where w.id = days.week_id
      and (
        p.client_id = auth.uid()
        or p.tenant_id = public.current_tenant_id()
        or public.current_role() = 'superadmin'
      )
  ))
  with check (exists (
    select 1
    from public.weeks w
    join public.programs p on p.id = w.program_id
    where w.id = days.week_id
      and (
        p.client_id = auth.uid()  -- trainee writes loggedAt + actuals on save
        or p.tenant_id = public.current_tenant_id()
        or public.current_role() = 'superadmin'
      )
  ));

create policy "exercises_all"
  on public.exercises for all to authenticated
  using (exists (
    select 1
    from public.days d
    join public.weeks w on w.id = d.week_id
    join public.programs p on p.id = w.program_id
    where d.id = exercises.day_id
      and (
        p.client_id = auth.uid()
        or p.tenant_id = public.current_tenant_id()
        or public.current_role() = 'superadmin'
      )
  ))
  with check (exists (
    select 1
    from public.days d
    join public.weeks w on w.id = d.week_id
    join public.programs p on p.id = w.program_id
    where d.id = exercises.day_id
      and (
        p.client_id = auth.uid()  -- trainees update actualLoad / actualRpe
        or p.tenant_id = public.current_tenant_id()
        or public.current_role() = 'superadmin'
      )
  ));

-- ─── program_templates ───────────────────────────────────────────────────────
-- Templates are private to their owning coach — no tenant-wide sharing. Only
-- coaches (or superadmin) can create them; trainees never read or write here.
create policy "program_templates_select"
  on public.program_templates for select to authenticated
  using (
    coach_id = auth.uid()
    or public.current_role() = 'superadmin'
  );

create policy "program_templates_insert"
  on public.program_templates for insert to authenticated
  with check (
    coach_id = auth.uid()
    and (public.current_role() = 'admin' or public.current_role() = 'superadmin')
  );

create policy "program_templates_update"
  on public.program_templates for update to authenticated
  using (coach_id = auth.uid() or public.current_role() = 'superadmin')
  with check (coach_id = auth.uid() or public.current_role() = 'superadmin');

create policy "program_templates_delete"
  on public.program_templates for delete to authenticated
  using (coach_id = auth.uid() or public.current_role() = 'superadmin');

-- ─── exercise_library ───────────────────────────────────────────────────────
-- Globals (coach_id NULL) are world-readable to authenticated users. Coach
-- rows are owner-private. Inserts are restricted to coaches (own coach_id)
-- and superadmin (for global seeding); updates/deletes are owner-only.
create policy "exercise_library_select"
  on public.exercise_library for select to authenticated
  using (
    coach_id is null
    or coach_id = auth.uid()
    or public.current_role() = 'superadmin'
  );

create policy "exercise_library_insert"
  on public.exercise_library for insert to authenticated
  with check (
    (coach_id = auth.uid()
      and (public.current_role() = 'admin' or public.current_role() = 'superadmin'))
    or (coach_id is null and public.current_role() = 'superadmin')
  );

create policy "exercise_library_update"
  on public.exercise_library for update to authenticated
  using (coach_id = auth.uid() or public.current_role() = 'superadmin')
  with check (coach_id = auth.uid() or public.current_role() = 'superadmin');

create policy "exercise_library_delete"
  on public.exercise_library for delete to authenticated
  using (coach_id = auth.uid() or public.current_role() = 'superadmin');

-- =============================================================================
-- Auth → profile bootstrap trigger
-- =============================================================================
--
-- When Supabase auth creates a row in auth.users (e.g. after signUp), insert
-- a matching row into public.profiles. The signup flow passes `name`, `role`,
-- and `tenant_id` via the options.data field on signUp() — those land in
-- raw_user_meta_data and are read here.
--
-- For trainee signup the frontend passes the invite code's tenant_id; for
-- coach signup (via SuperadminView) the metadata omits tenant_id and the
-- application updates the row to point at the new coach's own id afterwards.

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, email, role, tenant_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', new.email),
    new.email,
    coalesce(
      nullif(new.raw_user_meta_data->>'role', '')::user_role,
      'trainee'::user_role
    ),
    nullif(new.raw_user_meta_data->>'tenant_id', '')::uuid
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================================
-- RPC: increment_invite_usage(text)
-- =============================================================================
--
-- Atomically increments use_count for an invite code. Called from the signup
-- flow AFTER a successful trainee account creation. SECURITY DEFINER so the
-- newly-created (still-RLS-restricted) trainee can bump the counter even
-- though they don't own the row — the function runs with the table-owner's
-- privileges and skips the invite_codes_update_own policy.
--
-- Returns true if a row matched and was updated, false otherwise (so the
-- caller can no-op silently for stale / unknown codes without surfacing an
-- error to the user mid-signup).

-- DROP first so a re-run that changes the return type (e.g. void → boolean)
-- doesn't fail with `42P13: cannot change return type of existing function`.
drop function if exists public.increment_invite_usage(text);

create function public.increment_invite_usage(invite_code text)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  updated_id uuid;
begin
  if invite_code is null or btrim(invite_code) = '' then
    return false;
  end if;
  update public.invite_codes
     set use_count = use_count + 1
   where code = upper(btrim(invite_code))
   returning id into updated_id;
  return updated_id is not null;
end;
$$;

-- Allow both authenticated and anon to call this — the lookup is by secret
-- code and the function refuses to update without one.
grant execute on function public.increment_invite_usage(text) to authenticated, anon;

-- =============================================================================
-- Notes for Phase 2 (frontend migration) — NOT executed here:
--   1. Replace useAuth localStorage path with supabase.auth.signInWithPassword
--      / signUp / signOut. The trigger above ensures profiles is auto-populated.
--   2. Replace useProgramData persistClients pattern with supabase.from(...)
--      queries. The persistClients read-merge-write helper becomes obsolete
--      once the database is the source of truth.
--   3. Set up profiles.tenant_id during signup: trainee's tenant_id =
--      invite_codes.tenant_id at signup time; coach's tenant_id = own profile id.
--   4. Generate Database types via `supabase gen types typescript` and import
--      from src/lib/supabase.ts so queries are fully typed.
-- =============================================================================
