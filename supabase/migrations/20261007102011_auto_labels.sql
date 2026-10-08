-- Public-name detection: the browser asks the explorer for tags of the busiest
-- counterparties that have no label yet, then stores them as source = 'auto'.
-- Both run as the caller (RLS applies); manual labels are never overwritten.

-- Unlabeled counterparties of one wallet, busiest first (excludes the org's own wallets).
create or replace function public.unlabeled_counterparties(p_wallet uuid, p_limit int default 20)
returns setof text
language sql stable security invoker set search_path = ''
as $$
  select de.counterparty
  from public.daily_edges de
  join public.wallets w on w.id = de.wallet_id
  where de.wallet_id = p_wallet
    and not exists (select 1 from public.address_labels l
                    where l.org_id = w.org_id and l.chain_id = w.chain_id and l.address = de.counterparty)
    and not exists (select 1 from public.wallets o
                    where o.org_id = w.org_id and o.chain_id = w.chain_id and o.address = de.counterparty)
  group by de.counterparty
  order by sum(de.tx_count) desc
  limit greatest(1, least(p_limit, 100));
$$;

-- p_rows: [{address, name, type}]. Inserts only; existing (manual or auto) rows are kept.
create or replace function public.save_auto_labels(p_wallet uuid, p_rows jsonb)
returns int
language plpgsql security invoker set search_path = ''
as $$
declare n int;
begin
  insert into public.address_labels (org_id, chain_id, address, name, type, source)
  select w.org_id, w.chain_id, r.address, left(coalesce(r.name, ''), 80),
         case when r.type in ('PERSON', 'EXCHANGE', 'DEX', 'CONTRACT') then r.type else 'PERSON' end, 'auto'
  from public.wallets w,
       jsonb_to_recordset(p_rows) as r(address text, name text, type text)
  where w.id = p_wallet and coalesce(r.address, '') <> ''
  on conflict (org_id, chain_id, address) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.unlabeled_counterparties(uuid, int) from public, anon;
revoke all on function public.save_auto_labels(uuid, jsonb) from public, anon;
grant execute on function public.unlabeled_counterparties(uuid, int) to authenticated;
grant execute on function public.save_auto_labels(uuid, jsonb) to authenticated;
