-- Rework player identity/display model:
-- - display_name optional
-- - add real first/last names
-- - allow choosing what is publicly shown
-- - add self-service RPC for linked player accounts

alter table if exists public.players add column if not exists real_first_name text;
alter table if exists public.players add column if not exists real_last_name text;
alter table if exists public.players add column if not exists show_display_name boolean not null default true;
alter table if exists public.players add column if not exists show_real_first_name boolean not null default false;
alter table if exists public.players add column if not exists show_real_last_name boolean not null default false;
alter table if exists public.players alter column display_name drop not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'players_name_presence_check'
      and conrelid = 'public.players'::regclass
  ) then
    alter table public.players
      add constraint players_name_presence_check
      check (
        nullif(trim(display_name), '') is not null
        or nullif(trim(real_first_name), '') is not null
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'players_visible_name_choice_check'
      and conrelid = 'public.players'::regclass
  ) then
    alter table public.players
      add constraint players_visible_name_choice_check
      check (show_display_name or show_real_first_name);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'players_display_flag_has_value_check'
      and conrelid = 'public.players'::regclass
  ) then
    alter table public.players
      add constraint players_display_flag_has_value_check
      check ((not show_display_name) or nullif(trim(display_name), '') is not null);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'players_first_flag_has_value_check'
      and conrelid = 'public.players'::regclass
  ) then
    alter table public.players
      add constraint players_first_flag_has_value_check
      check ((not show_real_first_name) or nullif(trim(real_first_name), '') is not null);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'players_last_flag_has_value_check'
      and conrelid = 'public.players'::regclass
  ) then
    alter table public.players
      add constraint players_last_flag_has_value_check
      check ((not show_real_last_name) or nullif(trim(real_last_name), '') is not null);
  end if;
end $$;

create or replace function public.player_public_name(p public.players)
returns text
language plpgsql
stable
as $$
declare
  parts text[] := '{}';
  d text := nullif(trim(p.display_name), '');
  f text := nullif(trim(p.real_first_name), '');
  l text := nullif(trim(p.real_last_name), '');
begin
  if p.show_display_name and d is not null then
    parts := array_append(parts, d);
  end if;

  if p.show_real_first_name and f is not null then
    parts := array_append(parts, f);
  end if;

  if p.show_real_last_name and l is not null then
    parts := array_append(parts, l);
  end if;

  if array_length(parts, 1) is not null then
    return array_to_string(parts, ' ');
  end if;

  if d is not null then
    return d;
  end if;
  if f is not null and l is not null then
    return f || ' ' || l;
  end if;
  if f is not null then
    return f;
  end if;
  if l is not null then
    return l;
  end if;
  return '(unnamed player)';
end;
$$;

revoke all on function public.player_public_name(public.players) from public;
grant execute on function public.player_public_name(public.players) to anon, authenticated;

create or replace function public.update_my_player_display(
  p_display_name text default null,
  p_real_first_name text default null,
  p_real_last_name text default null,
  p_show_display_name boolean default true,
  p_show_real_first_name boolean default false,
  p_show_real_last_name boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id uuid;
begin
  select pa.player_id
  into v_player_id
  from public.player_accounts pa
  where pa.auth_user_id = auth.uid();

  if v_player_id is null then
    raise exception 'player account not linked';
  end if;

  update public.players
  set
    display_name = nullif(trim(p_display_name), ''),
    real_first_name = nullif(trim(p_real_first_name), ''),
    real_last_name = nullif(trim(p_real_last_name), ''),
    show_display_name = coalesce(p_show_display_name, false),
    show_real_first_name = coalesce(p_show_real_first_name, false),
    show_real_last_name = coalesce(p_show_real_last_name, false)
  where id = v_player_id;

  return v_player_id;
end;
$$;

revoke all on function public.update_my_player_display(text, text, text, boolean, boolean, boolean) from public;
grant execute on function public.update_my_player_display(text, text, text, boolean, boolean, boolean) to authenticated;

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
  public.player_public_name(p.*) as display_name,
  r.raw_points,
  r.club_points,
  r.placement,
  r.tobi
from public.matches m
join public.match_results r on r.match_id = m.id
join public.players p on p.id = r.player_id
where m.status = 'final';

create or replace view public.v_current_ratings
with (security_invoker = true)
as
select
  rs.is_lifetime,
  rs.season_id,
  rs.player_id,
  public.player_public_name(p.*) as display_name,
  rs.rate,
  rs.games_played,
  rs.updated_at
from public.rating_state rs
join public.players p on p.id = rs.player_id;

create or replace view public.v_rating_history
with (security_invoker = true)
as
select
  re.is_lifetime,
  re.season_id,
  re.player_id,
  public.player_public_name(p.*) as display_name,
  m.played_at,
  re.match_id,
  re.placement,
  re.old_rate,
  re.delta,
  re.new_rate,
  re.games_played_before
from public.rating_events re
join public.matches m on m.id = re.match_id
join public.players p on p.id = re.player_id
where m.status = 'final';
