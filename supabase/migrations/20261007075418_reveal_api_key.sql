-- Showing a saved API key in the UI requires an email OTP verified within the last 5 minutes.
-- Supabase records how the current session was obtained in the JWT `amr` claim; verifying an
-- email code adds {"method": "otp", "timestamp": <unix seconds>}.

create or replace function private.recent_email_otp(max_age_seconds int default 300)
returns boolean
language sql stable set search_path = ''
as $$
  select exists (
    select 1 from jsonb_array_elements(coalesce((select auth.jwt()) -> 'amr', '[]'::jsonb)) a
    where a ->> 'method' in ('otp', 'magiclink', 'email/signup')
      and (a ->> 'timestamp')::bigint >= extract(epoch from now())::bigint - max_age_seconds
  );
$$;
revoke all on function private.recent_email_otp(int) from public, anon;
grant execute on function private.recent_email_otp(int) to authenticated;

-- Admins only, and only right after an email OTP. Errors use distinct codes so the UI can react.
create or replace function public.reveal_api_key(p_chain text)
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  k text;
  found boolean;
begin
  select true, s.decrypted_secret into found, k
  from public.provider_connections c
  left join vault.decrypted_secrets s on s.id = c.api_key_secret_id
  where c.chain_id = p_chain and c.org_id in (select private.user_org_ids('admin'))
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
