-- muse_connector.sql — already applied. Read-only calendar access for an AI assistant (Meta Muse),
-- limited to the app owner's account. Only SHA-256 hashes of keys are stored.
create table if not exists public.calendar_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  token_hash text not null unique,
  label text not null default 'AI assistant',
  tz text not null default 'America/Denver',
  created_at timestamptz not null default now(),
  last_used timestamptz
);
alter table public.calendar_tokens enable row level security;
create policy "own tokens select" on public.calendar_tokens for select to authenticated using ((select auth.uid()) = user_id);
create policy "owner only insert" on public.calendar_tokens for insert to authenticated
  with check ((select auth.uid()) = user_id and user_id = '0e7ff033-c3cc-4c6f-ab5a-34fd5eb16153'::uuid);
create policy "own tokens delete" on public.calendar_tokens for delete to authenticated using ((select auth.uid()) = user_id);
revoke all on public.calendar_tokens from anon;
grant select, insert, delete on public.calendar_tokens to authenticated;
-- The calendar-mcp Edge Function also checks app_secrets.calendar_owner before answering.
insert into public.app_secrets (name, value) values ('calendar_owner', '0e7ff033-c3cc-4c6f-ab5a-34fd5eb16153')
on conflict (name) do update set value = excluded.value;
