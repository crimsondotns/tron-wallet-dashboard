-- Sync correctness fixes.
-- 1) newest_ts no longer moves on every ingested page. While catching up on new transfers
--    (newest -> oldest) an interrupted run used to leave newest_ts at the top of the gap, so the
--    rest of the gap was never fetched. Now ingest_transfers only seeds newest_ts on the very
--    first page; the client calls advance_sync_head once it has paged all the way down to the
--    old newest_ts.
-- 2) Re-ingesting a transfer updates its status (e.g. UNCONFIRMED -> SUCCESS / FAILED), and
--    summaries only count transfers whose status is a success.
-- 3) p_kind is checked against the known kinds.

-- Statuses that count as money actually moving. Providers send SUCCESS (tronscan finalResult,
-- trongrid contractRet), CONFIRMED / UNCONFIRMED (tronscan native transfers); anything else
-- (FAILED, REVERT, OUT_OF_ENERGY, ...) is a failed transaction. UNCONFIRMED is counted because a
-- row may not be fetched again after it confirms.
create or replace function private.is_counted_status(p_status text)
returns boolean
language sql immutable set search_path = ''
as $$
  select upper(coalesce(p_status, 'SUCCESS')) in ('SUCCESS', 'CONFIRMED', 'UNCONFIRMED');
$$;
revoke all on function private.is_counted_status(text) from public, anon;
grant execute on function private.is_counted_status(text) to authenticated, service_role;

create or replace function private.check_sync_kind(p_kind text)
returns void
language plpgsql immutable set search_path = ''
as $$
begin
  if p_kind is null or p_kind not in ('native', 'token') then
    raise exception 'unknown sync kind' using errcode = '22023';
  end if;
end;
$$;
revoke all on function private.check_sync_kind(text) from public, anon;
grant execute on function private.check_sync_kind(text) to authenticated;

create or replace function public.claim_sync(p_wallet uuid, p_kind text, p_seconds int default 120)
returns setof public.sync_cursors
language plpgsql security definer set search_path = ''
as $$
declare
  w public.wallets := private.member_wallet(p_wallet);
  me uuid := (select auth.uid());
begin
  perform private.check_sync_kind(p_kind);
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

-- Push one page. Same signature as before. Returns rows newly inserted (status updates of
-- existing rows are applied but not counted).
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
  perform private.check_sync_kind(p_kind);
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
    -- one row per dedup key: "on conflict do update" can't touch the same row twice
    select distinct on (hash, log_index, token_symbol, from_addr, to_addr) *
    from (
      select r->>'hash' as hash,
             coalesce((r->>'log_index')::int, -1) as log_index,
             to_timestamp((r->>'ts')::bigint / 1000.0) as ts,
             r->>'from' as from_addr, r->>'to' as to_addr,
             left(coalesce(nullif(r->>'token_symbol', ''), '?'), 32) as token_symbol,
             nullif(r->>'token_address', '') as token_address,
             (r->>'raw')::numeric / power(10::numeric, least(greatest(coalesce((r->>'decimals')::int, 0), 0), 36)) as amount,
             left(coalesce(nullif(r->>'status', ''), 'SUCCESS'), 32) as status
      from jsonb_array_elements(p_rows) r
      where r->>'hash' ~ '^[0-9a-fA-Fx]{32,80}$' and (r->>'raw') ~ '^[0-9]+$'
    ) s
    order by hash, log_index, token_symbol, from_addr, to_addr
  ), ins as (
    insert into public.transfers as t (org_id, wallet_id, chain_id, tx_hash, log_index, ts, dir,
                                       token_address, token_symbol, amount, from_addr, to_addr, status)
    select w.org_id, w.id, w.chain_id, hash, log_index, ts,
           case when from_addr = w.address and to_addr = w.address then 'SELF'
                when to_addr = w.address then 'IN' else 'OUT' end,
           token_address, token_symbol, amount, from_addr, to_addr, status
    from src
    where from_addr = w.address or to_addr = w.address          -- only rows that involve this wallet
    on conflict (wallet_id, tx_hash, log_index, token_symbol, from_addr, to_addr) do update
      set status = excluded.status
      where t.status is distinct from excluded.status
        and upper(excluded.status) <> 'UNCONFIRMED'               -- never step back to unconfirmed
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted) into n from ins;

  update public.sync_cursors c
     set pages = c.pages + 1,
         -- only seeded on the first page ever; afterwards advance_sync_head moves it
         newest_ts = coalesce(c.newest_ts, (select max(to_timestamp((r->>'ts')::bigint / 1000.0)) from jsonb_array_elements(p_rows) r)),
         backfill_cursor = coalesce(p_backfill_cursor, c.backfill_cursor),
         done = c.done or coalesce(p_done, false),
         last_run_at = now(), last_error = null,
         lease_until = now() + interval '120 seconds'
   where c.wallet_id = w.id and c.kind = p_kind;
  return n;
end;
$$;

-- Called once the "newer than newest_ts" pass has reached the old newest_ts, so everything up
-- to p_newest_ts is stored. Requires the caller's lease. Never moves newest_ts backwards.
create or replace function public.advance_sync_head(p_wallet uuid, p_kind text, p_newest_ts timestamptz)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  w public.wallets := private.member_wallet(p_wallet);
  me uuid := (select auth.uid());
begin
  perform private.check_sync_kind(p_kind);
  update public.sync_cursors c
     set newest_ts = greatest(c.newest_ts, least(p_newest_ts, now() + interval '1 day'))
   where c.wallet_id = w.id and c.kind = p_kind and c.lease_owner = me and c.lease_until >= now();
  if not found then
    raise exception 'lease lost' using errcode = '55P03';
  end if;
end;
$$;
revoke all on function public.advance_sync_head(uuid, text, timestamptz) from public, anon;
grant execute on function public.advance_sync_head(uuid, text, timestamptz) to authenticated;

-- Summaries count successful transfers only.
create or replace function private.refresh_wallet_summaries(p_wallet_id uuid)
returns void
language sql security definer set search_path = ''
as $$
  delete from public.daily_flows where wallet_id = p_wallet_id;
  insert into public.daily_flows (org_id, wallet_id, day, token_symbol, amount_in, amount_out, tx_count)
  select org_id, wallet_id, (ts at time zone 'UTC')::date, token_symbol,
         coalesce(sum(amount) filter (where dir = 'IN'), 0), coalesce(sum(amount) filter (where dir = 'OUT'), 0), count(*)
  from public.transfers where wallet_id = p_wallet_id and private.is_counted_status(status)
  group by 1, 2, 3, 4;

  delete from public.edges where wallet_id = p_wallet_id;
  insert into public.edges (org_id, wallet_id, counterparty, token_symbol, total_in, total_out, tx_count, first_ts, last_ts)
  select org_id, wallet_id, case when dir = 'IN' then from_addr else to_addr end, token_symbol,
         coalesce(sum(amount) filter (where dir = 'IN'), 0), coalesce(sum(amount) filter (where dir = 'OUT'), 0),
         count(*), min(ts), max(ts)
  from public.transfers where wallet_id = p_wallet_id and dir <> 'SELF' and private.is_counted_status(status)
  group by 1, 2, 3, 4;

  delete from public.daily_edges where wallet_id = p_wallet_id;
  insert into public.daily_edges (org_id, wallet_id, day, counterparty, token_symbol, amount_in, amount_out, tx_count)
  select org_id, wallet_id, (ts at time zone 'UTC')::date, case when dir = 'IN' then from_addr else to_addr end, token_symbol,
         coalesce(sum(amount) filter (where dir = 'IN'), 0), coalesce(sum(amount) filter (where dir = 'OUT'), 0), count(*)
  from public.transfers where wallet_id = p_wallet_id and dir <> 'SELF' and private.is_counted_status(status)
  group by 1, 2, 3, 4, 5;
$$;

-- Rebuild existing summaries so failed transfers drop out.
select private.refresh_wallet_summaries(id) from public.wallets;
