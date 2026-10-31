-- schema.sql — run this once in Supabase: SQL Editor → New query → paste → Run.
--
-- One table holds every record from every tracker. Each row belongs to one user,
-- and Row Level Security (RLS) makes sure a signed-in user can only ever see or
-- change their own rows, even though the app's key is public.

create table if not exists public.items (
  user_id    uuid        not null default auth.uid() references auth.users on delete cascade,
  id         text        not null,              -- the record's id from the app
  collection text        not null,              -- "tasks", "events", "subs", …
  data       jsonb       not null default '{}', -- the fields you typed
  updated_at timestamptz not null,              -- when it was last edited (set by the device)
  deleted    boolean     not null default false,-- soft delete so deletions sync too
  synced_at  timestamptz not null default clock_timestamp(), -- when the server got it (used to pull changes)
  primary key (user_id, id)
);

create index if not exists items_user_synced on public.items (user_id, synced_at);

-- Last-write-wins: if a device sends an older copy than the server has, ignore it.
-- Also stamp synced_at with the server's clock so pulling never depends on phone clocks.
create or replace function public.items_lww()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null; -- keep the newer server copy
  end if;
  new.synced_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists items_lww on public.items;
create trigger items_lww
  before insert or update on public.items
  for each row execute function public.items_lww();

-- Row Level Security
alter table public.items enable row level security;

drop policy if exists "read own items"   on public.items;
drop policy if exists "insert own items" on public.items;
drop policy if exists "update own items" on public.items;

create policy "read own items"   on public.items for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "insert own items" on public.items for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "update own items" on public.items for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
-- No delete policy on purpose: the app soft-deletes, so nothing can hard-delete your data.

-- Only signed-in users may touch the table at all.
revoke all on public.items from anon;
grant select, insert, update on public.items to authenticated;
