-- RLS/permission test. Run: supabase db query --linked -f supabase/tests/rls_test.sql
-- Always ends with 'RESULT ...' exception so every change is rolled back; each item shows actual (expected).
do $do$
declare
  ua uuid := gen_random_uuid();
  ub uuid := gen_random_uuid();
  uv uuid := gen_random_uuid();
  oa uuid; ob uuid; wa uuid; ca uuid;
  n int; ok boolean;
  res text := '';
begin
  insert into auth.users (id, email, aud, role) values
    (ua, ua || '@test.local', 'authenticated', 'authenticated'),
    (ub, ub || '@test.local', 'authenticated', 'authenticated'),
    (uv, uv || '@test.local', 'authenticated', 'authenticated');

  -- user A creates org A (as authenticated)
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  oa := public.create_org('Org A');
  insert into public.wallets (org_id, chain_id, address, label) values (oa, 'tron', 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf', 'A1') returning id into wa;
  insert into public.provider_connections (org_id, chain_id, provider, name) values (oa, 'tron', 'tronscan', 'c') returning id into ca;
  perform public.set_connection_api_key(ca, 'secret-key-123');

  -- user B creates org B
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  ob := public.create_org('Org B');

  -- worker data (service level)
  perform set_config('role', 'postgres', true);
  insert into public.transfers (org_id, wallet_id, chain_id, tx_hash, ts, dir, token_symbol, amount, from_addr, to_addr)
    values (oa, wa, 'tron', 'h1', now(), 'IN', 'TRX', 10, 'Tfrom', 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf');
  perform private.refresh_wallet_summaries(wa);
  insert into public.org_members (org_id, user_id, role) values (oa, uv, 'viewer');

  -- 1. B cannot see A's data
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  select count(*) into n from public.wallets;            res := res || 'B wallets=' || n || ' (0) | ';
  select count(*) into n from public.transfers;          res := res || 'B transfers=' || n || ' (0) | ';
  select count(*) into n from public.edges;              res := res || 'B edges=' || n || ' (0) | ';
  select count(*) into n from public.orgs;               res := res || 'B orgs=' || n || ' (1) | ';
  update public.wallets set label = 'hacked' where id = wa; get diagnostics n = row_count;
  res := res || 'B update A wallet rows=' || n || ' (0) | ';
  begin
    insert into public.wallets (org_id, chain_id, address) values (oa, 'tron', 'TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7');
    res := res || 'B insert into A: ALLOWED (BAD) | ';
  exception when others then res := res || 'B insert into A: denied | ';
  end;
  begin
    perform public.set_connection_api_key(ca, 'x');
    res := res || 'B set A key: ALLOWED (BAD) | ';
  exception when others then res := res || 'B set A key: denied | ';
  end;

  -- 2. A sees own data, cannot read key or change plan
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  select count(*) into n from public.transfers;          res := res || 'A transfers=' || n || ' (1) | ';
  select count(*) into n from public.edges;              res := res || 'A edges=' || n || ' (1) | ';
  begin
    perform private.connection_api_key(ca);
    res := res || 'A read key: ALLOWED (BAD) | ';
  exception when others then res := res || 'A read key: denied | ';
  end;
  begin
    update public.orgs set plan = 'business' where id = oa;
    res := res || 'A change plan: ALLOWED (BAD) | ';
  exception when others then res := res || 'A change plan: denied | ';
  end;
  begin
    insert into public.transfers (org_id, wallet_id, chain_id, tx_hash, ts, dir, token_symbol, amount, from_addr, to_addr)
      values (oa, wa, 'tron', 'h2', now(), 'IN', 'TRX', 1, 'a', 'b');
    res := res || 'A write transfers: ALLOWED (BAD) | ';
  exception when others then res := res || 'A write transfers: denied | ';
  end;

  -- 3. viewer reads but cannot write
  perform set_config('request.jwt.claims', json_build_object('sub', uv, 'role', 'authenticated')::text, true);
  select count(*) into n from public.wallets;            res := res || 'V wallets=' || n || ' (1) | ';
  update public.wallets set label = 'v' where id = wa; get diagnostics n = row_count;
  res := res || 'V update rows=' || n || ' (0) | ';

  -- 4. anon sees nothing
  perform set_config('role', 'anon', true);
  begin
    select count(*) into n from public.wallets; res := res || 'anon wallets=' || n || ' (0) | ';
  exception when others then res := res || 'anon wallets: denied | ';
  end;

  -- 5. service_role can read key
  perform set_config('role', 'service_role', true);
  select private.connection_api_key(ca) = 'secret-key-123' into ok;
  res := res || 'worker read key=' || ok || ' (true)';

  perform set_config('role', 'postgres', true);
  raise exception 'RESULT %', res;
end $do$;
