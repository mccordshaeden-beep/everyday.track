-- reminders_and_canvas.sql — already applied to the live project. Kept here for reference.

-- Devices that turned on reminders
create table if not exists public.push_subscriptions (
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  endpoint   text not null,
  p256dh     text not null,
  auth       text not null,
  device     text,
  created_at timestamptz not null default now(),
  primary key (user_id, endpoint)
);
alter table public.push_subscriptions enable row level security;
create policy "own subs select" on public.push_subscriptions for select to authenticated using ((select auth.uid()) = user_id);
create policy "own subs insert" on public.push_subscriptions for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own subs update" on public.push_subscriptions for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own subs delete" on public.push_subscriptions for delete to authenticated using ((select auth.uid()) = user_id);
revoke all on public.push_subscriptions from anon;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- Scheduled notifications (written by the app, sent by the push function)
create table if not exists public.reminders (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  fire_at timestamptz not null, kind text not null default 'other',
  title text not null, body text, url text, sent_at timestamptz
);
create unique index if not exists reminders_unique on public.reminders (user_id, kind, fire_at, title);
create index if not exists reminders_due on public.reminders (fire_at) where sent_at is null;
alter table public.reminders enable row level security;
create policy "own reminders select" on public.reminders for select to authenticated using ((select auth.uid()) = user_id);
create policy "own reminders insert" on public.reminders for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own reminders delete" on public.reminders for delete to authenticated using ((select auth.uid()) = user_id);
revoke all on public.reminders from anon;
grant select, insert, delete on public.reminders to authenticated;

-- Server-only secrets: RLS on, no policies, so only the service role can read them
create table if not exists public.app_secrets (name text primary key, value text not null);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;
insert into public.app_secrets (name, value) values ('cron_secret', encode(extensions.gen_random_bytes(24), 'hex')) on conflict do nothing;

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- Every 5 minutes: send due reminders
select cron.schedule('everyday-send-reminders', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://rzkcynppocaxgydmsyvu.supabase.co/functions/v1/push',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select value from public.app_secrets where name = 'cron_secret')),
    body := '{"action":"cron"}'::jsonb, timeout_milliseconds := 60000);
$$);
