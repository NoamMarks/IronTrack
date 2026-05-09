create table if not exists public.body_weight_log (
  id          uuid primary key default uuid_generate_v4(),
  client_id   uuid not null references public.profiles(id) on delete cascade,
  weight_kg   numeric(6,2) not null check (weight_kg > 0 and weight_kg < 500),
  logged_at   date not null default current_date,
  created_at  timestamptz not null default now(),
  unique(client_id, logged_at)
);

alter table public.body_weight_log enable row level security;

create policy "Users manage own weight log"
  on public.body_weight_log for all
  using (client_id = auth.uid())
  with check (client_id = auth.uid());

create policy "Coaches read tenant weight logs"
  on public.body_weight_log for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'superadmin')
    )
  );
