-- Money map tab: one row per (wallet, counterparty) for the range, limited to the busiest
-- counterparties, plus moves between the selected wallets (internal = true). Runs as the
-- caller, so RLS limits it to their orgs.
create or replace function public.overview_graph(
  p_from date, p_to date, p_token text, p_wallets uuid[] default null, p_top int default 40
)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with w as (
    select id, address from public.wallets where p_wallets is null or id = any (p_wallets)
  ), e as (
    select de.wallet_id, de.counterparty,
           sum(de.amount_in) as a_in, sum(de.amount_out) as a_out, sum(de.tx_count) as n
    from public.daily_edges de
    where de.wallet_id in (select id from w) and de.token_symbol = p_token
      and de.day between p_from and p_to
    group by de.wallet_id, de.counterparty
  ), top as (
    select counterparty from e
    where counterparty not in (select address from w)
    group by counterparty
    order by sum(a_in + a_out) desc
    limit greatest(1, least(p_top, 200))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'wallet', e.wallet_id, 'address', e.counterparty, 'in', e.a_in, 'out', e.a_out, 'tx', e.n,
           'internal', e.counterparty in (select address from w))), '[]'::jsonb)
  from e
  where e.counterparty in (select counterparty from top) or e.counterparty in (select address from w);
$$;
revoke all on function public.overview_graph(date, date, text, uuid[], int) from public, anon;
grant execute on function public.overview_graph(date, date, text, uuid[], int) to authenticated;
