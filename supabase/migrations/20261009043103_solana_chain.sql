-- Solana support (idempotent).
--   1) chains.family allows 'solana'; a 'solana' chain row (SOL, 9 decimals, Solscan).
--   2) wallets address check gains a Solana branch: base58, 32-44 chars, case-sensitive (never
--      lowercased). TRON and EVM branches are unchanged.
--   3) ingest_transfers: from/to and hash regexes per family. Solana addresses are base58
--      32-44 chars, transaction signatures base58 64-90 chars; tron/evm regexes are unchanged.
--      Body = 20261008112355_ingest_row_validation.sql; only lines marked "-- [solana]" differ.
--      The earliest accepted timestamp moves from 2018-01-01 (TRON mainnet) to 2015-07-30
--      (Ethereum genesis) so early Ethereum history isn't silently dropped.
--   4) provider_connections.provider also allows the new EVM providers ('routescan',
--      'blockscout') and 'solana_rpc'.

-- 1) chain family + row
do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.chains'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%family%'
  loop
    execute format('alter table public.chains drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.chains add constraint chains_family_check
  check (family in ('tron', 'evm', 'solana'));

insert into public.chains (id, family, name, evm_chain_id, native_symbol, native_decimals, explorer_url)
values ('solana', 'solana', 'Solana', null, 'SOL', 9, 'https://solscan.io/tx/')
on conflict (id) do nothing;

-- 2) wallet address format per chain
do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.wallets'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%address%'
  loop
    execute format('alter table public.wallets drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.wallets add constraint wallets_address_format check (
  (chain_id = 'tron' and address ~ '^T[1-9A-HJ-NP-Za-km-z]{33}$')
  or (chain_id = 'solana' and address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')
  or (chain_id not in ('tron', 'solana') and address ~ '^0x[0-9a-f]{40}$')
);

-- 3) ingest_transfers
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
  fam text := (select family from public.chains where id = w.chain_id);                  -- [solana]
  addr_re text := case fam                                                                 -- [solana]
                    when 'tron' then '^T[1-9A-HJ-NP-Za-km-z]{33}$'
                    when 'solana' then '^[1-9A-HJ-NP-Za-km-z]{32,44}$'                     -- [solana]
                    else '^0x[0-9a-fA-F]{40}$' end;
  hash_re text := case fam                                                                 -- [solana]
                    when 'solana' then '^[1-9A-HJ-NP-Za-km-z]{64,90}$'                     -- [solana]
                    else '^[0-9a-fA-Fx]{32,80}$' end;                                     -- [solana]
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
    where ts >= '2015-07-30'::timestamptz and ts <= now() + interval '1 day'
      and decimals is not null and log_index is not null
      and coalesce(r->>'from', '') ~ addr_re and coalesce(r->>'to', '') ~ addr_re
      and r->>'hash' ~ hash_re and (r->>'raw') ~ '^[0-9]{1,78}$'                           -- [solana]
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
           where x.t >= '2015-07-30'::timestamptz and x.t <= now() + interval '1 day')),
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

-- 4) provider ids
alter table public.provider_connections drop constraint if exists provider_connections_provider_check;
alter table public.provider_connections add constraint provider_connections_provider_check
  check (provider in ('tronscan', 'trongrid', 'etherscan', 'routescan', 'blockscout', 'alchemy', 'ankr', 'evm_rpc', 'solana_rpc'));
