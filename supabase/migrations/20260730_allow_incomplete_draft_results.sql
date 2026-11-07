-- Drafts can hold an unfinished score sheet: a player without a score yet, or a
-- score without a player. Finalizing is what requires a complete one.

alter table public.match_results
  alter column player_id drop not null,
  alter column raw_points drop not null;

-- A save writes all four seats in one statement. Checking "one seat per player"
-- when that statement ends lets two players swap seats, which otherwise fails on
-- the first row while the second still holds the old value.
alter table public.match_results
  drop constraint match_results_match_id_player_id_key,
  add constraint match_results_match_id_player_id_key
    unique (match_id, player_id) deferrable initially immediate;

-- Backstop for the application's own check: nothing incomplete can be published.
create or replace function public.guard_match_results_complete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.match_results mr
    where mr.match_id = new.id
      and (mr.player_id is null or mr.raw_points is null)
  ) then
    raise exception 'match % has seats without a player or score', new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_match_results_complete() from public, anon, authenticated;

create trigger matches_guard_results_complete
before update of status on public.matches
for each row
when (old.status = 'draft' and new.status = 'final')
execute function public.guard_match_results_complete();

-- An empty seat has no player to check.
create or replace function public.guard_match_result_discipline()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.player_id is not null then
    perform public.assert_player_competitive_eligible(new.match_id, new.player_id);
  end if;
  return new;
end;
$$;

create or replace function public.guard_match_discipline()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id uuid;
begin
  if new.status = 'void' then
    return new;
  end if;

  for v_player_id in
    select mr.player_id
    from public.match_results mr
    where mr.match_id = new.id
      and mr.player_id is not null
    order by mr.player_id
  loop
    perform public.assert_player_competitive_eligible(new.id, v_player_id);
  end loop;

  return new;
end;
$$;
