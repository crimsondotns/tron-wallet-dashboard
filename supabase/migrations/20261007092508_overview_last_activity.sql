-- Overview: token list and default token are all-time (not range-bound), and the summary
-- reports the selected token's last active day so an empty range can point to it.

-- Summary tab. Runs as the caller, so RLS limits it to their orgs.
-- p_from/p_to inclusive (UTC days); p_wallets null = all wallets; the previous period of the
-- same length is returned for comparison; p_token null picks the busiest token (all time), and
-- the token list plus the token's last active day are returned too (for the empty state). Transfers between the selected wallets are internal
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
    -- all-time, so the token picker still works when the chosen range is empty
    select token_symbol, sum(amount_in + amount_out) as vol, max(day) as last_day
    from public.daily_flows
    where wallet_id in (select id from w)
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
    'last_day', (select last_day from tokens where token_symbol = (select token from pick)),
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
