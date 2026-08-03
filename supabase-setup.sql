-- Monthly To-Do Tracker: secure per-user cloud storage and realtime updates
-- Run this entire file once in Supabase > SQL Editor.

create table if not exists public.tracker_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tracker_data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.tracker_profiles enable row level security;

drop policy if exists "Users can read their own tracker" on public.tracker_profiles;
create policy "Users can read their own tracker"
on public.tracker_profiles
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own tracker" on public.tracker_profiles;
create policy "Users can create their own tracker"
on public.tracker_profiles
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own tracker" on public.tracker_profiles;
create policy "Users can update their own tracker"
on public.tracker_profiles
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own tracker" on public.tracker_profiles;
create policy "Users can delete their own tracker"
on public.tracker_profiles
for delete
to authenticated
using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.tracker_profiles to authenticated;

-- Add the table to Supabase Realtime only when it is not already included.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'tracker_profiles'
  ) then
    alter publication supabase_realtime add table public.tracker_profiles;
  end if;
end
$$;
