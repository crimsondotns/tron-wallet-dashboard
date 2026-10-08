-- Browser-side sync: the member's browser fetches from the provider (with the org's own
-- API key) and pushes pages here. The database never trusts derived values from the client:
-- direction and decimal scaling are computed here, summaries are rebuilt here.

-- One connection per chain per org (MVP).
create unique index provider_connections_org_chain_key on public.provider_connections (org_id, chain_id);

-- Lease so two open browsers don't fetch the same wallet at once.
alter table public.sync_cursors
  add column lease_owner uuid,
  add column lease_until timestamptz;

-- Wallet must belong to an org the caller is a member of; returns the wallet row.
create or replace function private.member_wallet(p_wallet uuid)
returns public.wallets
language plpgsql stable security definer set search_path = ''
as $$
declare
  w public.wallets;
begin
  select * into w from public.wallets where id = p_wallet;
  if w.id is null or w.org_id not in (select private.user_org_ids()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return w;
end;
$$;
revoke all on function private.member_wallet(uuid) from public, anon;
grant execute on function private.member_wallet(uuid) to authenticated;

-- Provider settings for the caller's org on a chain, including the decrypted key.
-- Members can read it: the browser needs it to call the provider (it is the org's own key).
create or replace function public.my_provider_key(p_chain text)
returns table (connection_id uuid, provider text, endpoint_url text, api_key text)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.provider, c.endpoint_url, s.decrypted_secret
  from public.provider_connections c
  left join vault.decrypted_secrets s on s.id = c.api_key_secret_id
  where c.chain_id = p_chain
    and c.status <> 'disabled'
    and c.org_id in (select private.user_org_ids())
  order by c.created_at
  limit 1;
$$;
revoke all on function public.my_provider_key(text) from public, anon;
grant execute on function public.my_provider_key(text) to authenticated;

-- Claim (or renew) the lease for one wallet+kind. Returns the cursor, or nothing if another
-- browser holds an unexpired lease.
create or replace function public.claim_sync(p_wallet uuid, p_kind text, p_seconds int default 120)
returns setof public.sync_cursors
language plpgsql security definer set search_path = ''
as $$
declare
  w public.wallets := private.member_wallet(p_wallet);
  me uuid := (select auth.uid());
begin
  insert into public.sync_cursors (wallet_id, kind, org_id) values (w.id, p_kind, w.org_id)
  on conflict (wallet_id, kind) do nothing;
  return query
    update public.sync_cursors
       set lease_owner = me, lease_until = now() + make_interval(secs => least(greatest(p_seconds, 30), 600))
     where wallet_id = w.id and kind = p_kind
       and (lease_owner is null or lease_owner = me or lease_until < now())
    returning *;
end;
$$;
revoke all on function public.claim_sync(uuid, text, int) from public, anon;
grant execute on function public.claim_sync(uuid, text, int) to authenticated;

-- Push one page. p_rows: [{hash, log_index, ts (ms), from, to, token_symbol, token_address,
-- raw (integer string), decimals, status}]. Requires the caller's lease. Returns rows inserted.
create or replace function public.ingest_transfers(
  p_wallet uuid, p_kind text, p_rows jsonb,
  p_backfill_cursor jsonb, p_done boolean
)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  w public.wallets := private.member_wallet(p_wallet);
  me uuid := (select auth.uid());
  n int;
begin
  if not exists (
    select 1 from public.sync_cursors
    where wallet_id = w.id and kind = p_kind and lease_owner = me and lease_until >= now()
  ) then
    raise exception 'lease lost' using errcode = '55P03';
  end if;
  if jsonb_array_length(coalesce(p_rows, '[]')) > 200 then
    raise exception 'too many rows' using errcode = '54000';
  end if;

  with src as (
    select r->>'hash' as hash,
           coalesce((r->>'log_index')::int, -1) as log_index,
           to_timestamp((r->>'ts')::bigint / 1000.0) as ts,
           r->>'from' as from_addr, r->>'to' as to_addr,
           coalesce(nullif(r->>'token_symbol', ''), '?') as token_symbol,
           nullif(r->>'token_address', '') as token_address,
           (r->>'raw')::numeric / power(10::numeric, least(greatest(coalesce((r->>'decimals')::int, 0), 0), 36)) as amount,
           coalesce(r->>'status', 'SUCCESS') as status
    from jsonb_array_elements(p_rows) r
    where r->>'hash' ~ '^[0-9a-fA-Fx]{32,80}$' and (r->>'raw') ~ '^[0-9]+$'
  ), ins as (
    insert into public.transfers (org_id, wallet_id, chain_id, tx_hash, log_index, ts, dir,
                                  token_address, token_symbol, amount, from_addr, to_addr, status)
    select w.org_id, w.id, w.chain_id, hash, log_index, ts,
           case when from_addr = w.address and to_addr = w.address then 'SELF'
                when to_addr = w.address then 'IN' else 'OUT' end,
           token_address, left(token_symbol, 32), amount, from_addr, to_addr, left(status, 32)
    from src
    where from_addr = w.address or to_addr = w.address          -- only rows that involve this wallet
    on conflict (wallet_id, tx_hash, log_index, token_symbol, from_addr, to_addr) do nothing
    returning ts
  )
  select count(*) into n from ins;

  update public.sync_cursors c
     set pages = c.pages + 1,
         newest_ts = greatest(c.newest_ts, (select max(to_timestamp((r->>'ts')::bigint / 1000.0)) from jsonb_array_elements(p_rows) r)),
         backfill_cursor = coalesce(p_backfill_cursor, c.backfill_cursor),
         done = c.done or coalesce(p_done, false),
         last_run_at = now(), last_error = null,
         lease_until = now() + interval '120 seconds'
   where c.wallet_id = w.id and c.kind = p_kind;
  return n;
end;
$$;
revoke all on function public.ingest_transfers(uuid, text, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.ingest_transfers(uuid, text, jsonb, jsonb, boolean) to authenticated;

-- Release the lease (optionally recording an error) and rebuild the wallet's summaries.
create or replace function public.release_sync(p_wallet uuid, p_kind text, p_error text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  w public.wallets := private.member_wallet(p_wallet);
begin
  update public.sync_cursors
     set lease_owner = null, lease_until = null, last_run_at = now(), last_error = left(p_error, 500)
   where wallet_id = w.id and kind = p_kind and lease_owner = (select auth.uid());
  perform private.refresh_wallet_summaries(w.id);
end;
$$;
revoke all on function public.release_sync(uuid, text, text) from public, anon;
grant execute on function public.release_sync(uuid, text, text) to authenticated;
