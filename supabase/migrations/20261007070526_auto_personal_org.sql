-- Users never set up an org themselves: each new user gets a personal org (owner) on sign-up.
-- Orgs stay in the schema so teams can share wallets later.

create or replace function private.create_personal_org()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  new_id uuid;
begin
  insert into public.orgs (name) values (coalesce(nullif(split_part(new.email, '@', 1), ''), 'Personal'))
  returning id into new_id;
  insert into public.org_members (org_id, user_id, role) values (new_id, new.id, 'owner');
  return new;
end;
$$;
revoke all on function private.create_personal_org() from public, anon, authenticated;

create trigger on_auth_user_created_personal_org
  after insert on auth.users
  for each row execute function private.create_personal_org();

-- Backfill users who signed up before this migration and have no org yet.
do $$
declare
  u record;
  new_id uuid;
begin
  for u in
    select au.id, au.email from auth.users au
    where not exists (select 1 from public.org_members m where m.user_id = au.id)
  loop
    insert into public.orgs (name) values (coalesce(nullif(split_part(u.email, '@', 1), ''), 'Personal'))
    returning id into new_id;
    insert into public.org_members (org_id, user_id, role) values (new_id, u.id, 'owner');
  end loop;
end $$;
