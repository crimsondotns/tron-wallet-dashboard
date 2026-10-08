-- Overview page: counterparty totals per day (so 7/30/90-day filters never touch raw transfers)
-- and one RPC that returns the whole summary tab as a small JSON document.

create table public.daily_edges (
  org_id uuid not null references public.orgs (id) on delete cascade,
  wallet_id uuid not null references public.wallets (id) on delete cascade,
  day date not null,
  counterparty text not null,
  token_symbol text not null,
  amount_in numeric(78, 18) not null default 0,
  amount_out numeric(78, 18) not null default 0,
  tx_count int not null default 0,
  primary key (wallet_id, day, counterparty, token_symbol)
);
create index daily_edges_org_day_idx on public.daily_edges (org_id, day);
alter table public.daily_edges enable row level security;
create policy daily_edges_read on public.daily_edges for select to authenticated
  using (org_id in (select private.user_org_ids()));
grant select on public.daily_edges to authenticated;

-- Rebuild all per-wallet summaries, now including daily_edges.
create or replace function private.refresh_wallet_summaries(p_wallet_id uuid)
returns void
language sql security definer set search_path = ''
as $$
  delete from public.daily_flows where wallet_id = p_wallet_id;
  insert into public.daily_flows (org_id, wallet_id, day, token_symbol, amount_in, amount_out, tx_count)
  select org_id, wallet_id, (ts at time zone 'UTC')::date, token_symbol,
         coalesce(sum(amount) filter (where dir = 'IN'), 0), coalesce(sum(amount) filter (where dir = 'OUT'), 0), count(*)
  from public.transfers where wallet_id = p_wallet_id
  group by 1, 2, 3, 4;

  delete from public.edges where wallet_id = p_wallet_id;
  insert into public.edges (org_id, wallet_id, counterparty, token_symbol, total_in, total_out, tx_count, first_ts, last_ts)
  select org_id, wallet_id, case when dir = 'IN' then from_addr else to_addr end, token_symbol,
         coalesce(sum(amount) filter (where dir = 'IN'), 0), coalesce(sum(amount) filter (where dir = 'OUT'), 0),
         count(*), min(ts), max(ts)
  from public.transfers where wallet_id = p_wallet_id and dir <> 'SELF'
  group by 1, 2, 3, 4;

  delete from public.daily_edges where wallet_id = p_wallet_id;
  insert into public.daily_edges (org_id, wallet_id, day, counterparty, token_symbol, amount_in, amount_out, tx_count)
  select org_id, wallet_id, (ts at time zone 'UTC')::date, case when dir = 'IN' then from_addr else to_addr end, token_symbol,
         coalesce(sum(amount) filter (where dir = 'IN'), 0), coalesce(sum(amount) filter (where dir = 'OUT'), 0), count(*)
  from public.transfers where wallet_id = p_wallet_id and dir <> 'SELF'
  group by 1, 2, 3, 4, 5;
$$;

-- Backfill daily_edges for wallets that already have transfers.
select private.refresh_wallet_summaries(id) from public.wallets;

-- Summary tab. Runs as the caller, so RLS limits it to their orgs.
-- p_from/p_to inclusive (UTC days); p_wallets null = all wallets; the previous period of the
-- same length is returned for comparison; p_token null picks the busiest token, and the token
-- list is returned too. Transfers between the selected wallets are internal
-- moves, not inflow/outflow, so they're left out everywhere (viewing one wallet alone still
-- counts its transfers to the others).
create or replace function public.overview_summary(
  p_from date, p_to date, p_token text default null, p_wallets uuid[] default null, p_top int default 8
)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with w as (
    select id, address from public.wallets where p_wallets is null or id = any (p_wallets)
  ), tokens as (
    select token_symbol, sum(amount_in + amount_out) as vol
    from public.daily_flows
    where wallet_id in (select id from w) and day between p_from and p_to
    group by token_symbol
  ), pick as (
    -- null p_token = the token with the most volume in the range
    select coalesce(p_token, (select token_symbol from tokens order by vol desc limit 1)) as token
  ), e as (
    select de.day, de.counterparty, de.amount_in, de.amount_out, de.tx_count
    from public.daily_edges de
    where de.wallet_id in (select id from w) and de.token_symbol = (select token from pick)
      and de.day between p_from - (p_to - p_from + 1) and p_to
      and de.counterparty not in (select address from w)
  ), flows as (
    select day, sum(amount_in) as a_in, sum(amount_out) as a_out, sum(tx_count) as n from e group by day
  ), cps as (
    select counterparty, sum(amount_in) as a_in, sum(amount_out) as a_out, sum(tx_count) as n
    from e where day >= p_from group by counterparty
  )
  select jsonb_build_object(
    'token', (select token from pick),
    'tokens', coalesce((select jsonb_agg(token_symbol order by vol desc) from tokens), '[]'::jsonb),
    'in', coalesce((select sum(a_in) from flows where day >= p_from), 0),
    'out', coalesce((select sum(a_out) from flows where day >= p_from), 0),
    'tx', coalesce((select sum(n) from flows where day >= p_from), 0),
    'prev_in', coalesce((select sum(a_in) from flows where day < p_from), 0),
    'prev_out', coalesce((select sum(a_out) from flows where day < p_from), 0),
    'counterparties', (select count(*) from cps),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'in', a_in, 'out', a_out) order by day)
                       from flows where day >= p_from), '[]'::jsonb),
    'top', coalesce((select jsonb_agg(jsonb_build_object('address', counterparty, 'in', a_in, 'out', a_out, 'tx', n) order by a_in + a_out desc)
                     from (select * from cps order by a_in + a_out desc limit greatest(1, least(p_top, 50))) t), '[]'::jsonb)
  );
$$;
revoke all on function public.overview_summary(date, date, text, uuid[], int) from public, anon;
grant execute on function public.overview_summary(date, date, text, uuid[], int) to authenticated;
