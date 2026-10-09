-- Security hardening (audit 2026-10-08).
-- Policy: only org admins/owners sync. Reading the provider key additionally needs a recent
-- email OTP step-up. Viewers are read-only.

-- 1. Step-up only counts a verified email code (verifyOtp type 'email' => amr method 'otp').
--    Sign-up confirmation and magic links no longer count. Login itself is password-based.
create or replace function private.recent_email_otp(max_age_seconds int default 300)
returns boolean
language sql stable set search_path = ''
as $$
  select exists (
    select 1 from jsonb_array_elements(coalesce((select auth.jwt()) -> 'amr', '[]'::jsonb)) a
    where a ->> 'method' = 'otp'
      and (a ->> 'timestamp') ~ '^[0-9]{1,12}$'
      and (a ->> 'timestamp')::bigint >= extract(epoch from now())::bigint - max_age_seconds
  );
$$;

-- 1. Decrypted provider key: admins only, after an email OTP in the last 12 hours (the browser
--    re-syncs every few minutes, so the window is longer than reveal_api_key's 5 minutes).
--    42501 = not an admin (UI hides sync), P0401 = OTP step-up needed (UI shows OtpDialog).
create or replace function public.my_provider_key(p_chain text)
returns table (connection_id uuid, provider text, endpoint_url text, api_key text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  c public.provider_connections;
begin
  -- Same connection the caller would have used before (first in any org they belong to)...
  select * into c from public.provider_connections pc
  where pc.chain_id = p_chain and pc.status <> 'disabled'
    and pc.org_id in (select private.user_org_ids())
  order by pc.created_at
  limit 1;
  if c.id is null then
    return; -- not set up: the UI shows the "connect a provider" hint
  end if;
  -- ...but only an admin of that org, after a recent email OTP, gets it.
  if c.org_id not in (select private.user_org_ids('admin')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not private.recent_email_otp(43200) then
    raise exception 'otp required' using errcode = 'P0401';
  end if;
  return query
    select c.id, c.provider, c.endpoint_url, s.decrypted_secret
    from vault.decrypted_secrets s
    right join (select 1) one on s.id = c.api_key_secret_id;
end;
$$;
revoke all on function public.my_provider_key(text) from public, anon;
grant execute on function public.my_provider_key(text) to authenticated;

-- 2. claim_sync / ingest_transfers / release_sync / advance_sync_head all go through member_wallet:
--    require admin + email OTP within 12h,
--    so viewers can no longer push (fake) transfers.
create or replace function private.member_wallet(p_wallet uuid)
returns public.wallets
language plpgsql stable security definer set search_path = ''
as $$
declare
  w public.wallets;
begin
  select * into w from public.wallets where id = p_wallet;
  if w.id is null or w.org_id not in (select private.user_org_ids('admin')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not private.recent_email_otp(43200) then
    raise exception 'otp required' using errcode = 'P0401';
  end if;
  return w;
end;
$$;

-- 3. Endpoint must be https; changing provider or endpoint drops the stored key unless the
--    same statement also sets a new one (set_connection_api_key runs as a separate update).
--    Stops "point the saved key at my own server" exfiltration.
alter table public.provider_connections
  add constraint provider_connections_endpoint_https
  check (endpoint_url is null or endpoint_url ~ '^https://[^/\s@]+(/\S*)?$') not valid;

create or replace function private.connection_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- 6. Never leave an orphaned secret in Vault.
    if old.api_key_secret_id is not null then
      delete from vault.secrets where id = old.api_key_secret_id;
    end if;
    return old;
  end if;
  if (new.endpoint_url is distinct from old.endpoint_url or new.provider is distinct from old.provider)
     and old.api_key_secret_id is not null
     and new.api_key_secret_id is not distinct from old.api_key_secret_id then
    delete from vault.secrets where id = old.api_key_secret_id;
    new.api_key_secret_id := null;
    new.status := 'untested';
  end if;
  return new;
end;
$$;
revoke all on function private.connection_guard() from public, anon, authenticated;

create trigger provider_connections_guard_update
  before update on public.provider_connections
  for each row execute function private.connection_guard();
create trigger provider_connections_guard_delete
  before delete on public.provider_connections
  for each row execute function private.connection_guard();

-- 6. daily_edges is written only by refresh_wallet_summaries (security definer).
revoke insert, update, delete, truncate, references, trigger on public.daily_edges from anon, authenticated;
revoke all on public.daily_edges from anon;

-- 6. create_org: every user already gets a personal org on sign-up. Keep it (tests use it)
--    but cap how many orgs one user can own.
create or replace function public.create_org(org_name text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  new_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if (select count(*) from public.org_members where user_id = (select auth.uid()) and role = 'owner') >= 3 then
    raise exception 'org limit reached' using errcode = '54000';
  end if;
  insert into public.orgs (name) values (left(coalesce(nullif(trim(org_name), ''), 'Org'), 80)) returning id into new_id;
  insert into public.org_members (org_id, user_id, role) values (new_id, (select auth.uid()), 'owner');
  return new_id;
end;
$$;
revoke all on function public.create_org(text) from public, anon;
grant execute on function public.create_org(text) to authenticated;

-- 6. Owners may change roles / remove members of their org, but not add arbitrary users
--    directly (memberships come from sign-up/create_org; invitations will add a definer RPC).
drop policy members_manage on public.org_members;
create policy members_update on public.org_members for update to authenticated
  using (org_id in (select private.user_org_ids('owner')))
  with check (org_id in (select private.user_org_ids('owner')));
create policy members_delete on public.org_members for delete to authenticated
  using (org_id in (select private.user_org_ids('owner')));
revoke insert on public.org_members from anon, authenticated;
