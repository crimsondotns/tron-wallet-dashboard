-- sum() over an empty filter is null; coalesce before inserting into not-null columns.
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
$$;

-- Worker (service_role) calls private.connection_api_key / refresh_wallet_summaries.
grant usage on schema private to service_role;
