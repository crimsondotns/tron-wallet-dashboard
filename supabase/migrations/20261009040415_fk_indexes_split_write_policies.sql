-- Cover chain_id foreign keys (advisor 0001).
create index if not exists address_labels_chain_id_idx on public.address_labels (chain_id);
create index if not exists provider_connections_chain_id_idx on public.provider_connections (chain_id);
create index if not exists transfers_chain_id_idx on public.transfers (chain_id);
create index if not exists wallets_chain_id_idx on public.wallets (chain_id);

-- Split admin "for all" write policies so SELECT is evaluated by one policy only (advisor 0006).
-- Same rules: members read; admins insert/update/delete.
do $$
declare
  t record;
begin
  for t in select * from (values
    ('provider_connections', 'connections'),
    ('wallets', 'wallets'),
    ('address_labels', 'labels')
  ) as v(tbl, prefix)
  loop
    execute format('drop policy if exists %I on public.%I', t.prefix || '_write', t.tbl);
    execute format('drop policy if exists %I on public.%I', t.prefix || '_insert', t.tbl);
    execute format('drop policy if exists %I on public.%I', t.prefix || '_update', t.tbl);
    execute format('drop policy if exists %I on public.%I', t.prefix || '_delete', t.tbl);
    execute format($p$create policy %I on public.%I for insert to authenticated
      with check (org_id in (select private.user_org_ids('admin')))$p$, t.prefix || '_insert', t.tbl);
    execute format($p$create policy %I on public.%I for update to authenticated
      using (org_id in (select private.user_org_ids('admin')))
      with check (org_id in (select private.user_org_ids('admin')))$p$, t.prefix || '_update', t.tbl);
    execute format($p$create policy %I on public.%I for delete to authenticated
      using (org_id in (select private.user_org_ids('admin')))$p$, t.prefix || '_delete', t.tbl);
  end loop;
end $$;
