-- Wallet Flow: multi-tenant, multi-chain schema
-- Tenancy: every customer row carries org_id; RLS allows members of that org only.
-- Writes to transfers / sync state / summaries come from the worker (service_role, bypasses RLS).

create schema if not exists private;

-- ---------- Orgs & membership ----------
create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 100),
  plan text not null default 'free' check (plan in ('free', 'pro', 'business')),
  created_at timestamptz not null default now()
);

create table public.org_members (
  org_id uuid not null references public.orgs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'viewer' check (role in ('owner', 'admin', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index org_members_user_id_idx on public.org_members (user_id);

-- Org ids the caller belongs to (optionally with a minimum role). Called once per query via (select ...).
create or replace function private.user_org_ids(min_role text default 'viewer')
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select m.org_id from public.org_members m
  where m.user_id = (select auth.uid())
    and case min_role
          when 'owner' then m.role = 'owner'
          when 'admin' then m.role in ('owner', 'admin')
          else true
        end;
$$;
revoke all on function private.user_org_ids(text) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.user_org_ids(text) to authenticated;

-- ---------- Chains (global reference data) ----------
create table public.chains (
  id text primary key,                      -- 'tron', 'ethereum', 'bsc', 'polygon', ...
  family text not null check (family in ('tron', 'evm')),
  name text not null,
  evm_chain_id bigint,                      -- null for non-EVM
  native_symbol text not null,
  native_decimals int not null,
  explorer_url text
);

insert into public.chains (id, family, name, evm_chain_id, native_symbol, native_decimals, explorer_url) values
  ('tron',     'tron', 'TRON',            null,  'TRX', 6,  'https://tronscan.org/#/transaction/'),
  ('ethereum', 'evm',  'Ethereum',        1,     'ETH', 18, 'https://etherscan.io/tx/'),
  ('bsc',      'evm',  'BNB Smart Chain', 56,    'BNB', 18, 'https://bscscan.com/tx/'),
  ('polygon',  'evm',  'Polygon',         137,   'POL', 18, 'https://polygonscan.com/tx/'),
  ('arbitrum', 'evm',  'Arbitrum One',    42161, 'ETH', 18, 'https://arbiscan.io/tx/'),
  ('base',     'evm',  'Base',            8453,  'ETH', 18, 'https://basescan.org/tx/'),
  ('optimism', 'evm',  'OP Mainnet',      10,    'ETH', 18, 'https://optimistic.etherscan.io/tx/');

-- ---------- Provider connections (customer brings own endpoint / key) ----------
create table public.provider_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  chain_id text not null references public.chains (id),
  provider text not null check (provider in ('tronscan', 'trongrid', 'etherscan', 'alchemy', 'ankr', 'evm_rpc')),
  name text not null,
  endpoint_url text,                        -- null = provider default
  api_key_secret_id uuid,                   -- vault.secrets id; null = no key
  rate_limit_per_sec numeric not null default 4 check (rate_limit_per_sec > 0),
  status text not null default 'untested' check (status in ('untested', 'ok', 'error', 'disabled')),
  last_error text,
  last_checked_at timestamptz,
  created_at timestamptz not null default now()
);
create index provider_connections_org_id_idx on public.provider_connections (org_id);

-- Store/replace an API key in Vault. Only org admins; the key never comes back to the browser.
create or replace function public.set_connection_api_key(connection_id uuid, api_key text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  c public.provider_connections;
begin
  select * into c from public.provider_connections where id = connection_id;
  if c.id is null or c.org_id not in (select private.user_org_ids('admin')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if c.api_key_secret_id is not null then
    delete from vault.secrets where id = c.api_key_secret_id;
  end if;
  update public.provider_connections
     set api_key_secret_id = case when coalesce(api_key, '') = '' then null
                                  else vault.create_secret(api_key, 'conn_' || connection_id) end,
         status = 'untested'
   where id = connection_id;
end;
$$;
revoke all on function public.set_connection_api_key(uuid, text) from public, anon;
grant execute on function public.set_connection_api_key(uuid, text) to authenticated;

-- Worker-only: read the decrypted key.
create or replace function private.connection_api_key(connection_id uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select s.decrypted_secret from vault.decrypted_secrets s
  join public.provider_connections c on c.api_key_secret_id = s.id
  where c.id = connection_id;
$$;
revoke all on function private.connection_api_key(uuid) from public, anon, authenticated;
grant execute on function private.connection_api_key(uuid) to service_role;

-- ---------- Wallets ----------
create table public.wallets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  chain_id text not null references public.chains (id),
  connection_id uuid references public.provider_connections (id) on delete set null,
  address text not null,                    -- EVM stored lowercase
  label text not null default '',
  created_at timestamptz not null default now(),
  unique (org_id, chain_id, address),
  check (
    (chain_id = 'tron' and address ~ '^T[1-9A-HJ-NP-Za-km-z]{33}$')
    or (chain_id <> 'tron' and address ~ '^0x[0-9a-f]{40}$')
  )
);
create index wallets_connection_id_idx on public.wallets (connection_id);

-- ---------- Sync state (replaces data/state.json) ----------
create table public.sync_cursors (
  wallet_id uuid not null references public.wallets (id) on delete cascade,
  kind text not null check (kind in ('native', 'token')),
  org_id uuid not null references public.orgs (id) on delete cascade,
  newest_ts timestamptz,
  backfill_cursor jsonb,                    -- provider-specific (ts/offset, pageKey, block)
  done boolean not null default false,
  pages int not null default 0,
  last_run_at timestamptz,
  last_error text,
  primary key (wallet_id, kind)
);
create index sync_cursors_org_id_idx on public.sync_cursors (org_id);

-- ---------- Transfers ----------
create table public.transfers (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs (id) on delete cascade,
  wallet_id uuid not null references public.wallets (id) on delete cascade,
  chain_id text not null references public.chains (id),
  tx_hash text not null,
  log_index int not null default -1,        -- -1 = native transfer
  ts timestamptz not null,
  dir text not null check (dir in ('IN', 'OUT', 'SELF')),
  token_address text,                       -- null = native coin
  token_symbol text not null,
  amount numeric(78, 18) not null,          -- already divided by decimals
  from_addr text not null,
  to_addr text not null,
  status text not null default 'SUCCESS',
  unique (wallet_id, tx_hash, log_index, token_symbol, from_addr, to_addr)
);
create index transfers_wallet_ts_idx on public.transfers (wallet_id, ts desc);
create index transfers_org_ts_idx on public.transfers (org_id, ts desc);

-- ---------- Address labels (replaces AddressBook + auto classification) ----------
create table public.address_labels (
  org_id uuid not null references public.orgs (id) on delete cascade,
  chain_id text not null references public.chains (id),
  address text not null,
  name text not null default '',
  type text not null default 'PERSON' check (type in ('PERSON', 'EXCHANGE', 'DEX', 'CONTRACT')),
  source text not null default 'manual' check (source in ('manual', 'auto')),
  updated_at timestamptz not null default now(),
  primary key (org_id, chain_id, address)
);

-- ---------- Summaries (keep dashboard egress small) ----------
create table public.daily_flows (
  org_id uuid not null references public.orgs (id) on delete cascade,
  wallet_id uuid not null references public.wallets (id) on delete cascade,
  day date not null,
  token_symbol text not null,
  amount_in numeric(78, 18) not null default 0,
  amount_out numeric(78, 18) not null default 0,
  tx_count int not null default 0,
  primary key (wallet_id, day, token_symbol)
);
create index daily_flows_org_day_idx on public.daily_flows (org_id, day);

create table public.edges (
  org_id uuid not null references public.orgs (id) on delete cascade,
  wallet_id uuid not null references public.wallets (id) on delete cascade,
  counterparty text not null,
  token_symbol text not null,
  total_in numeric(78, 18) not null default 0,
  total_out numeric(78, 18) not null default 0,
  tx_count int not null default 0,
  first_ts timestamptz not null,
  last_ts timestamptz not null,
  primary key (wallet_id, counterparty, token_symbol)
);
create index edges_org_id_idx on public.edges (org_id);

-- Rebuild summaries for one wallet (worker calls after inserting a batch).
create or replace function private.refresh_wallet_summaries(p_wallet_id uuid)
returns void
language sql security definer set search_path = ''
as $$
  delete from public.daily_flows where wallet_id = p_wallet_id;
  insert into public.daily_flows (org_id, wallet_id, day, token_symbol, amount_in, amount_out, tx_count)
  select org_id, wallet_id, (ts at time zone 'UTC')::date, token_symbol,
         sum(amount) filter (where dir = 'IN'), sum(amount) filter (where dir = 'OUT'), count(*)
  from public.transfers where wallet_id = p_wallet_id
  group by 1, 2, 3, 4;
  update public.daily_flows set amount_in = coalesce(amount_in, 0), amount_out = coalesce(amount_out, 0)
  where wallet_id = p_wallet_id and (amount_in is null or amount_out is null);

  delete from public.edges where wallet_id = p_wallet_id;
  insert into public.edges (org_id, wallet_id, counterparty, token_symbol, total_in, total_out, tx_count, first_ts, last_ts)
  select org_id, wallet_id, case when dir = 'IN' then from_addr else to_addr end, token_symbol,
         coalesce(sum(amount) filter (where dir = 'IN'), 0), coalesce(sum(amount) filter (where dir = 'OUT'), 0),
         count(*), min(ts), max(ts)
  from public.transfers where wallet_id = p_wallet_id and dir <> 'SELF'
  group by 1, 2, 3, 4;
$$;
revoke all on function private.refresh_wallet_summaries(uuid) from public, anon, authenticated;
grant execute on function private.refresh_wallet_summaries(uuid) to service_role;

-- ---------- Onboarding: create org + make caller owner ----------
create or replace function public.create_org(org_name text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  new_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  insert into public.orgs (name) values (org_name) returning id into new_id;
  insert into public.org_members (org_id, user_id, role) values (new_id, (select auth.uid()), 'owner');
  return new_id;
end;
$$;
revoke all on function public.create_org(text) from public, anon;
grant execute on function public.create_org(text) to authenticated;

-- ---------- RLS ----------
alter table public.orgs enable row level security;
alter table public.org_members enable row level security;
alter table public.chains enable row level security;
alter table public.provider_connections enable row level security;
alter table public.wallets enable row level security;
alter table public.sync_cursors enable row level security;
alter table public.transfers enable row level security;
alter table public.address_labels enable row level security;
alter table public.daily_flows enable row level security;
alter table public.edges enable row level security;

create policy chains_read on public.chains for select to authenticated using (true);

create policy orgs_read on public.orgs for select to authenticated
  using (id in (select private.user_org_ids()));
create policy orgs_update on public.orgs for update to authenticated
  using (id in (select private.user_org_ids('owner')))
  with check (id in (select private.user_org_ids('owner')));

create policy members_read on public.org_members for select to authenticated
  using (org_id in (select private.user_org_ids()));
create policy members_manage on public.org_members for all to authenticated
  using (org_id in (select private.user_org_ids('owner')))
  with check (org_id in (select private.user_org_ids('owner')));

-- Members read; admins write. (Billing columns on orgs are changed by service_role only.)
create policy connections_read on public.provider_connections for select to authenticated
  using (org_id in (select private.user_org_ids()));
create policy connections_write on public.provider_connections for all to authenticated
  using (org_id in (select private.user_org_ids('admin')))
  with check (org_id in (select private.user_org_ids('admin')));

create policy wallets_read on public.wallets for select to authenticated
  using (org_id in (select private.user_org_ids()));
create policy wallets_write on public.wallets for all to authenticated
  using (org_id in (select private.user_org_ids('admin')))
  with check (org_id in (select private.user_org_ids('admin')));

create policy labels_read on public.address_labels for select to authenticated
  using (org_id in (select private.user_org_ids()));
create policy labels_write on public.address_labels for all to authenticated
  using (org_id in (select private.user_org_ids('admin')))
  with check (org_id in (select private.user_org_ids('admin')));

-- Worker-owned tables: read-only for members.
create policy cursors_read on public.sync_cursors for select to authenticated
  using (org_id in (select private.user_org_ids()));
create policy transfers_read on public.transfers for select to authenticated
  using (org_id in (select private.user_org_ids()));
create policy daily_flows_read on public.daily_flows for select to authenticated
  using (org_id in (select private.user_org_ids()));
create policy edges_read on public.edges for select to authenticated
  using (org_id in (select private.user_org_ids()));

-- Users may not change plan/api_key_secret_id directly.
-- (Column REVOKE is ignored while a table-level grant exists, so grant columns explicitly.)
revoke insert, update on public.orgs from authenticated, anon;
grant update (name) on public.orgs to authenticated;
revoke insert, update on public.provider_connections from authenticated, anon;
grant insert (org_id, chain_id, provider, name, endpoint_url, rate_limit_per_sec) on public.provider_connections to authenticated;
grant update (name, endpoint_url, rate_limit_per_sec) on public.provider_connections to authenticated;
revoke insert, update, delete on public.sync_cursors, public.transfers, public.daily_flows, public.edges from authenticated, anon;
