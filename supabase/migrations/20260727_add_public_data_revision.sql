-- Cheap public snapshot invalidation.
--
-- Readers may inspect the singleton revision, but only trusted trigger
-- functions can advance it. Draft match edits are intentionally excluded:
-- public match data changes only when a final row is inserted, updated, or
-- deleted.

create table public.public_data_revision (
  scope text primary key,
  revision bigint not null default 1,
  changed_at timestamptz not null default now(),
  constraint public_data_revision_scope_check
    check (scope = 'scoreboard'),
  constraint public_data_revision_revision_check
    check (revision >= 1)
);

insert into public.public_data_revision (scope, revision)
values ('scoreboard', 1);

alter table public.public_data_revision enable row level security;

revoke all on public.public_data_revision from public, anon, authenticated;
grant select on public.public_data_revision to anon, authenticated;

create policy public_data_revision_public_read
on public.public_data_revision
for select
to anon, authenticated
using (scope = 'scoreboard');

create or replace function public.bump_public_data_revision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.public_data_revision
  set revision = revision + 1,
      changed_at = statement_timestamp()
  where scope = 'scoreboard';

  if not found then
    raise exception 'public data revision singleton is missing';
  end if;

  return null;
end;
$$;

create or replace function public.bump_public_data_revision_for_final_match()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_affects_public_data boolean := false;
begin
  if tg_op = 'DELETE' then
    v_affects_public_data := old.status = 'final';
  elsif tg_op = 'UPDATE' then
    v_affects_public_data := old.status = 'final' or new.status = 'final';
  elsif tg_op = 'INSERT' then
    v_affects_public_data := new.status = 'final';
  end if;

  if v_affects_public_data then
    update public.public_data_revision
    set revision = revision + 1,
        changed_at = statement_timestamp()
    where scope = 'scoreboard';

    if not found then
      raise exception 'public data revision singleton is missing';
    end if;
  end if;

  return null;
end;
$$;

revoke all on function public.bump_public_data_revision() from public, anon, authenticated;
revoke all on function public.bump_public_data_revision_for_final_match() from public, anon, authenticated;

create trigger seasons_bump_public_data_revision
after insert or update or delete on public.seasons
for each statement execute function public.bump_public_data_revision();

create trigger casual_events_bump_public_data_revision
after insert or update or delete on public.casual_events
for each statement execute function public.bump_public_data_revision();

create trigger players_bump_public_data_revision
after insert or update or delete on public.players
for each statement execute function public.bump_public_data_revision();

create trigger rulesets_bump_public_data_revision
after insert or update or delete on public.rulesets
for each statement execute function public.bump_public_data_revision();

create trigger adjustments_bump_public_data_revision
after insert or update or delete on public.adjustments
for each statement execute function public.bump_public_data_revision();

-- Final result rows are immutable. Draft result edits become public through
-- the match status transition, so the match trigger is the single invalidator.
create trigger matches_bump_public_data_revision
after insert or update or delete on public.matches
for each row execute function public.bump_public_data_revision_for_final_match();
