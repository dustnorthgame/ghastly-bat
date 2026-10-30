-- supabase-schema.sql — run once in your Supabase project's SQL editor.
-- Public visitors can READ results. Only signed-in accounts listed in usher_admins can WRITE.

create table if not exists public.usher_state (
  id         text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.usher_admins (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);

alter table public.usher_state  enable row level security;
alter table public.usher_admins enable row level security;

-- Anyone (including logged-out visitors) may read the published election state.
drop policy if exists "usher_state public read" on public.usher_state;
create policy "usher_state public read"
  on public.usher_state for select
  using (true);

-- Only listed admins may create or change it. Nobody can delete it through the API.
drop policy if exists "usher_state admin insert" on public.usher_state;
create policy "usher_state admin insert"
  on public.usher_state for insert to authenticated
  with check (exists (select 1 from public.usher_admins a where a.user_id = auth.uid()));

drop policy if exists "usher_state admin update" on public.usher_state;
create policy "usher_state admin update"
  on public.usher_state for update to authenticated
  using      (exists (select 1 from public.usher_admins a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.usher_admins a where a.user_id = auth.uid()));

-- Admins can see that they are admins; nobody can add admins through the API.
drop policy if exists "usher_admins self read" on public.usher_admins;
create policy "usher_admins self read"
  on public.usher_admins for select to authenticated
  using (user_id = auth.uid());

-- Live updates to every open page.
alter publication supabase_realtime add table public.usher_state;

-- After creating your admin user (Authentication > Users > Add user), grant access:
--   insert into public.usher_admins (user_id)
--   select id from auth.users where email = 'you@example.com';
