-- Profiles should store account email (for admin account linking UI), not a redundant display_name.
alter table if exists public.profiles add column if not exists email text;

update public.profiles p
set email = nullif(trim(u.email), '')
from auth.users u
where u.id = p.id
  and p.email is distinct from nullif(trim(u.email), '');

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (
    new.id,
    nullif(trim(new.email), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

alter table if exists public.profiles drop column if exists display_name;
