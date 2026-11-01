-- Two-step login enforced by the database (applied as migration "require_mfa_when_enrolled").
-- Once an account has a verified authenticator, its session must be aal2 (password + code)
-- to read or write anything. Accounts without 2-step are unaffected.
create or replace function private.mfa_ok() returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2'
      or not exists (select 1 from auth.mfa_factors f
                     where f.user_id = (select auth.uid()) and f.status = 'verified');
$$;
revoke all on function private.mfa_ok() from public, anon;
grant execute on function private.mfa_ok() to authenticated;
grant usage on schema private to authenticated;

-- A RESTRICTIVE policy is ANDed with the normal "own rows" policies.
do $$
declare t text;
begin
  foreach t in array array['items','shared_items','households','household_members','push_subscriptions','reminders','calendar_tokens'] loop
    execute format('drop policy if exists "require two-step when enabled" on public.%I', t);
    execute format('create policy "require two-step when enabled" on public.%I as restrictive for all to authenticated using ((select private.mfa_ok())) with check ((select private.mfa_ok()))', t);
  end loop;
end $$;

-- create_household, join_household, new_household_code and share_with_person (SECURITY DEFINER)
-- each start with:
--   if not (select private.mfa_ok()) then raise exception 'Two-step verification needed…'; end if;

-- Verified (rolled-back test): with an authenticator enrolled, an aal1 session sees 0 rows;
-- aal2 sees everything; accounts without an authenticator are unchanged.
