-- reveal_api_key: pick the oldest connection, like my_provider_key, so an admin of
-- several orgs on the same chain always gets the same key.
create or replace function public.reveal_api_key(p_chain text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  k text;
  found boolean;
begin
  select true, s.decrypted_secret into found, k
  from public.provider_connections c
  left join vault.decrypted_secrets s on s.id = c.api_key_secret_id
  where c.chain_id = p_chain and c.org_id in (select private.user_org_ids('admin'))
  order by c.created_at
  limit 1;
  if not coalesce(found, false) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not private.recent_email_otp() then
    raise exception 'otp required' using errcode = 'P0401';
  end if;
  return k;
end;
$$;

revoke all on function public.reveal_api_key(text) from public, anon;
grant execute on function public.reveal_api_key(text) to authenticated;
