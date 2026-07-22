-- Add columns used by Excel season import.
-- Run this once on existing databases.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'table_mode') then
    create type public.table_mode as enum ('A','M');
  end if;
end $$;

alter table if exists public.matches add column if not exists game_number int;
alter table if exists public.matches add column if not exists table_mode public.table_mode;
alter table if exists public.matches add column if not exists extra_sticks int not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'matches_game_number_check'
      and conrelid = 'public.matches'::regclass
  ) then
    alter table public.matches
      add constraint matches_game_number_check check (game_number is null or game_number > 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'matches_extra_sticks_check'
      and conrelid = 'public.matches'::regclass
  ) then
    alter table public.matches
      add constraint matches_extra_sticks_check check (extra_sticks >= 0);
  end if;
end $$;

create or replace view public.v_final_results
with (security_invoker = true)
as
select
  m.id as match_id,
  m.season_id,
  m.ruleset_id,
  m.game_number,
  m.table_mode,
  m.extra_sticks,
  m.played_at,
  m.table_label,
  r.seat,
  r.player_id,
  p.display_name,
  r.raw_points,
  r.club_points,
  r.placement,
  r.tobi
from public.matches m
join public.match_results r on r.match_id = m.id
join public.players p on p.id = r.player_id
where m.status = 'final';
