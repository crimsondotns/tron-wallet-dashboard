-- ingest_transfers: validate each pushed row; a malformed row is skipped, never aborts the page.
-- Body = 20261008112210_sync_head_and_status.sql's ingest_transfers; only lines marked
-- "-- [validation]" differ. Admin + OTP access comes from private.member_wallet
-- (20261008112253_security_hardening.sql).
--   * from/to must match the chain family (tron base58 / evm 0x+40 hex)
--   * ts must be integer ms between 2018-01-01 and now() + 1 day
--   * log_index / decimals / ts / raw are cast only after a regex check (inside CASE)
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
  addr_re text := case (select family from public.chains where id = w.chain_id)          -- [validation]
                    when 'tron' then '^T[1-9A-HJ-NP-Za-km-z]{33}$'                         -- [validation]
                    else '^0x[0-9a-fA-F]{40}$' end;                                       -- [validation]
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

  with parsed as (                                                                         -- [validation]
    select r,
           case when r->>'ts' ~ '^[0-9]{1,15}$'
                then to_timestamp((r->>'ts')::bigint / 1000.0) end as ts,
           case when coalesce(r->>'decimals', '0') ~ '^[0-9]{1,2}$'
                then least(coalesce((r->>'decimals')::int, 0), 36) end as decimals,
           case when coalesce(r->>'log_index', '-1') ~ '^-?[0-9]{1,9}$'
                then coalesce((r->>'log_index')::int, -1) end as log_index
    from jsonb_array_elements(coalesce(p_rows, '[]')) r
    where jsonb_typeof(r) = 'object'
  ), valid as (                                                                            -- [validation]
    select * from parsed
    where ts >= '2018-01-01'::timestamptz and ts <= now() + interval '1 day'
      and decimals is not null and log_index is not null
      and coalesce(r->>'from', '') ~ addr_re and coalesce(r->>'to', '') ~ addr_re
      and r->>'hash' ~ '^[0-9a-fA-Fx]{32,80}$' and (r->>'raw') ~ '^[0-9]{1,78}$'
  ), src as (
    -- one row per dedup key: "on conflict do update" can't touch the same row twice
    select distinct on (hash, log_index, token_symbol, from_addr, to_addr) *
    from (
      select r->>'hash' as hash,
             log_index,                                                                    -- [validation]
             ts,                                                                           -- [validation]
             r->>'from' as from_addr, r->>'to' as to_addr,
             left(coalesce(nullif(r->>'token_symbol', ''), '?'), 32) as token_symbol,
             nullif(r->>'token_address', '') as token_address,
             (r->>'raw')::numeric / power(10::numeric, decimals) as amount,                -- [validation]
             left(coalesce(nullif(r->>'status', ''), 'SUCCESS'), 32) as status
      from valid                                                                           -- [validation]
    ) s
    where amount < 1e59                                                                    -- [validation] fits numeric(78,18)
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
         -- [validation] seed only from in-range timestamps
         newest_ts = coalesce(c.newest_ts, (
           select max(x.t) from (
             select case when r->>'ts' ~ '^[0-9]{1,15}$' then to_timestamp((r->>'ts')::bigint / 1000.0) end as t
             from jsonb_array_elements(coalesce(p_rows, '[]')) r
             where jsonb_typeof(r) = 'object') x
           where x.t >= '2018-01-01'::timestamptz and x.t <= now() + interval '1 day')),
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
