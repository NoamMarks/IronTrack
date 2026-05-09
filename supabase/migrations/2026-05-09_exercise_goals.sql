-- =============================================================================
-- Exercise goals (target e1RM)
-- =============================================================================
--
-- One row per (trainee, exercise) recording a target estimated 1RM in kg.
-- Surfaced in the trainee's Analytics dashboard as a horizontal reference
-- line on the e1RM chart so they can see how close they are to the goal
-- they (or their coach) set.
--
-- The unique(client_id, exercise_id) constraint means upsert on conflict
-- replaces the prior goal — there's only ever one active target per
-- exercise per trainee. History of past goals is intentionally not kept
-- here; if that becomes a feature later it would be a separate
-- exercise_goal_log table to keep this row terminal.
--
-- RLS:
--   - Trainees fully own their own goals (insert/update/delete + select).
--   - Coaches and superadmin can SELECT goals across their tenant so the
--     coach-facing view of the trainee's analytics renders the same line.
--   - Coaches can NOT write goals on behalf of trainees from this policy
--     pair — that would need a separate "Coaches manage tenant goals"
--     ALL policy, intentionally omitted to keep goal-setting trainee-led.

create table if not exists public.exercise_goals (
  id          uuid primary key default uuid_generate_v4(),
  client_id   uuid not null references public.profiles(id) on delete cascade,
  exercise_id text not null,
  target_e1rm numeric(7,2) not null check (target_e1rm > 0),
  created_at  timestamptz not null default now(),
  unique(client_id, exercise_id)
);

alter table public.exercise_goals enable row level security;

create policy "Users manage own goals"
  on public.exercise_goals for all
  using (client_id = auth.uid())
  with check (client_id = auth.uid());

create policy "Coaches read tenant goals"
  on public.exercise_goals for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin','superadmin')
        and (
          p.role = 'superadmin'
          or (select tenant_id from public.profiles where id = exercise_goals.client_id) = p.tenant_id
        )
    )
  );
