-- Mahjong Club (Supabase/Postgres) schema v1.2
-- Supports:
-- - Seasons (semester-style)
-- - Players (separate from auth accounts; public-friendly)
-- - Matches with 4 seats (E/S/W/N) and raw end points
-- - Derived club points (return + uma + oka) stored at finalize-time
-- - Tenhou-like R rating per season AND lifetime, with rating history
-- - Public read for non-admin data; admin-only writes (RLS)
--
-- Notes:
-- - Views are created as SECURITY INVOKER to avoid bypassing RLS (Postgres 15+).
--   See: https://supabase.com/docs/guides/database/postgres/row-level-security#views

-- 0) Extensions
create extension if not exists pgcrypto;

-- 1) Auth profiles (admin flag lives here)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

alter table if exists public.profiles add column if not exists email text;
alter table public.profiles enable row level security;

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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

alter table if exists public.profiles drop column if exists display_name;

-- Helper: admin check
create or replace function public.is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = uid), false);
$$;

revoke all on function public.is_admin(uuid) from public;
grant execute on function public.is_admin(uuid) to authenticated;

-- 2) Core domain tables

create table if not exists public.seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  start_date date not null,
  end_date date not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  display_name text unique,
  real_first_name text,
  real_last_name text,
  show_display_name boolean not null default true,
  show_real_first_name boolean not null default false,
  show_real_last_name boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (
    nullif(trim(display_name), '') is not null
    or nullif(trim(real_first_name), '') is not null
  ),
  check (show_display_name or show_real_first_name),
  check ((not show_display_name) or nullif(trim(display_name), '') is not null),
  check ((not show_real_first_name) or nullif(trim(real_first_name), '') is not null),
  check ((not show_real_last_name) or nullif(trim(real_last_name), '') is not null)
);

-- Backfill-safe schema updates for existing projects
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

-- Optional mapping: auth user can claim a player identity
create table if not exists public.player_accounts (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (player_id)
);

-- Rulesets
create table if not exists public.rulesets (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  start_points int not null default 25000,
  return_points int not null default 20000,
  point_divisor int not null default 1000,
  uma_1 numeric not null default 30,
  uma_2 numeric not null default 10,
  uma_3 numeric not null default -10,
  uma_4 numeric not null default -30,
  oka_1 numeric not null default 0,
  oka_2 numeric not null default 0,
  oka_3 numeric not null default 0,
  oka_4 numeric not null default 0,
  created_at timestamptz not null default now()
);

-- Enums (safe create)
do $$
begin
  if not exists (select 1 from pg_type where typname = 'match_status') then
    create type public.match_status as enum ('draft','final','void');
  end if;
  if not exists (select 1 from pg_type where typname = 'seat') then
    create type public.seat as enum ('E','S','W','N');
  end if;
  if not exists (select 1 from pg_type where typname = 'table_mode') then
    create type public.table_mode as enum ('A','M');
  end if;
end $$;

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete restrict,
  ruleset_id uuid not null references public.rulesets(id) on delete restrict,
  game_number int,
  table_mode public.table_mode,
  extra_sticks int not null default 0,
  played_at timestamptz not null,
  status public.match_status not null default 'draft',
  table_label text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists matches_season_played_idx on public.matches (season_id, played_at desc);
create index if not exists matches_created_by_idx on public.matches (created_by);
create index if not exists matches_ruleset_id_idx on public.matches (ruleset_id);

-- Backfill-safe schema updates for existing projects
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

create table if not exists public.match_results (
  match_id uuid not null references public.matches(id) on delete cascade,
  seat public.seat not null,
  player_id uuid not null references public.players(id) on delete restrict,
  raw_points int not null,
  placement smallint,
  club_points numeric,
  tobi boolean not null default false,
  primary key (match_id, seat),
  unique (match_id, player_id),
  check (raw_points > -100000 and raw_points < 300000),
  check (placement is null or (placement between 1 and 4))
);
create index if not exists match_results_player_idx on public.match_results (player_id);
create index if not exists match_results_match_idx on public.match_results (match_id);

create table if not exists public.adjustments (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  points numeric not null,
  reason text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists adjustments_season_player_idx on public.adjustments (season_id, player_id);
create index if not exists adjustments_created_by_idx on public.adjustments (created_by);
create index if not exists adjustments_player_id_idx on public.adjustments (player_id);

-- 3) Tenhou-like rating (season + lifetime)

-- rating_state:
-- - is_lifetime=false: per-season rating, season_id required
-- - is_lifetime=true: lifetime rating, season_id must be NULL
create table if not exists public.rating_state (
  id uuid primary key default gen_random_uuid(),
  is_lifetime boolean not null default false,
  season_id uuid references public.seasons(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  games_played int not null default 0,
  rate numeric not null default 1500,
  updated_at timestamptz not null default now(),
  check (
    (is_lifetime and season_id is null) or
    ((not is_lifetime) and season_id is not null)
  )
);

-- Uniqueness per scope
create unique index if not exists rating_state_unique_season
on public.rating_state (season_id, player_id)
where is_lifetime = false;

create unique index if not exists rating_state_unique_lifetime
on public.rating_state (player_id)
where is_lifetime = true;

create table if not exists public.rating_events (
  id uuid primary key default gen_random_uuid(),
  is_lifetime boolean not null default false,
  season_id uuid references public.seasons(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  placement smallint not null check (placement between 1 and 4),
  old_rate numeric not null,
  delta numeric not null,
  new_rate numeric not null,
  games_played_before int not null,
  created_at timestamptz not null default now(),
  check (
    (is_lifetime and season_id is null) or
    ((not is_lifetime) and season_id is not null)
  )
);

create unique index if not exists rating_events_unique_season
on public.rating_events (season_id, match_id, player_id)
where is_lifetime = false;

create unique index if not exists rating_events_unique_lifetime
on public.rating_events (match_id, player_id)
where is_lifetime = true;

create index if not exists rating_events_player_idx on public.rating_events (player_id, created_at desc);

-- 4) Helpers

create or replace function public.player_public_name(p public.players)
returns text
language plpgsql
stable
set search_path = public
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

  -- Fallback for legacy/inconsistent rows.
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

create or replace function public.seat_priority(s public.seat)
returns int
language sql
immutable
set search_path = public
as $$
  select case s
    when 'E' then 1
    when 'S' then 2
    when 'W' then 3
    when 'N' then 4
  end;
$$;

create or replace function public.place_base_points(place smallint)
returns numeric
language sql
immutable
set search_path = public
as $$
  select case place
    when 1 then 30
    when 2 then 10
    when 3 then -10
    when 4 then -30
    else 0
  end;
$$;

create or replace function public.games_adjustment(n int)
returns numeric
language sql
immutable
set search_path = public
as $$
  -- Tenhou-style: if n <= 20, 1 - 0.04*n, floored at 0.2; else 0.2
  select case
    when n is null then 1
    when n <= 20 then greatest(1 - (0.4::numeric * n::numeric), 0.2)
    else 0.2
  end;
$$;

create or replace function public.uma_for_place(r public.rulesets, place smallint)
returns numeric
language sql
immutable
set search_path = public
as $$
  select case place
    when 1 then r.uma_1
    when 2 then r.uma_2
    when 3 then r.uma_3
    when 4 then r.uma_4
  end;
$$;

create or replace function public.oka_for_place(r public.rulesets, place smallint)
returns numeric
language sql
immutable
set search_path = public
as $$
  select case place
    when 1 then r.oka_1
    when 2 then r.oka_2
    when 3 then r.oka_3
    when 4 then r.oka_4
  end;
$$;

create or replace function public.compute_club_points(
  raw_points int,
  place smallint,
  ruleset_id uuid
) returns numeric
language plpgsql
stable
set search_path = public
as $$
declare r public.rulesets;
begin
  select * into r from public.rulesets where id = ruleset_id;
  if not found then
    raise exception 'ruleset % not found', ruleset_id;
  end if;

  return ((raw_points - r.return_points)::numeric / r.point_divisor::numeric)
         + public.uma_for_place(r, place)
         + public.oka_for_place(r, place);
end;
$$;

revoke all on function public.compute_club_points(int, smallint, uuid) from public;
grant execute on function public.compute_club_points(int, smallint, uuid) to anon, authenticated;

-- Recompute placement + club_points for a match (admin-only; works for draft or final)
create or replace function public.recompute_match_derived(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare m public.matches;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only';
  end if;

  select * into m from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'match % not found', p_match_id;
  end if;

  if (select count(*) from public.match_results where match_id = p_match_id) <> 4 then
    raise exception 'match % must have exactly 4 results', p_match_id;
  end if;

  if (select count(distinct seat) from public.match_results where match_id = p_match_id) <> 4 then
    raise exception 'match % must have 4 distinct seats', p_match_id;
  end if;

  if (select count(distinct player_id) from public.match_results where match_id = p_match_id) <> 4 then
    raise exception 'match % must have 4 distinct players', p_match_id;
  end if;

  -- Placement still uses seat tie-break.
  -- UMA is split across tied rank span by raw_points.
  with ranked as (
    select
      mr.match_id,
      mr.seat,
      row_number() over (order by mr.raw_points desc, public.seat_priority(mr.seat) asc) as placement,
      rank() over (order by mr.raw_points desc) as tie_rank_start,
      count(*) over (partition by mr.raw_points) as tie_size
    from public.match_results mr
    where mr.match_id = p_match_id
  ),
  scored as (
    select
      r.match_id,
      r.seat,
      r.placement,
      rs.return_points,
      rs.point_divisor,
      case r.placement
        when 1 then rs.oka_1
        when 2 then rs.oka_2
        when 3 then rs.oka_3
        when 4 then rs.oka_4
        else 0
      end as oka_points,
      (
        select avg(
          case gs.place
            when 1 then rs.uma_1
            when 2 then rs.uma_2
            when 3 then rs.uma_3
            when 4 then rs.uma_4
            else 0
          end
        )::numeric
        from generate_series(r.tie_rank_start, r.tie_rank_start + r.tie_size - 1) as gs(place)
      ) as split_uma
    from ranked r
    join public.rulesets rs on rs.id = m.ruleset_id
  )
  update public.match_results mr
  set
    placement = s.placement,
    club_points = ((mr.raw_points - s.return_points)::numeric / s.point_divisor::numeric)
                  + s.split_uma
                  + s.oka_points,
    tobi = (mr.raw_points < 0)
  from scored s
  where mr.match_id = s.match_id and mr.seat = s.seat;
end;
$$;

revoke all on function public.recompute_match_derived(uuid) from public;
grant execute on function public.recompute_match_derived(uuid) to authenticated;

-- 5) Finalize a match:
-- - recompute derived (placement/club_points)
-- - apply season rating
-- - optionally apply lifetime rating
-- - set match.status='final'
create or replace function public.finalize_match(
  p_match_id uuid,
  p_update_lifetime boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.matches;
  rec record;
  avg_rate numeric;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only';
  end if;

  select * into m from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'match % not found', p_match_id;
  end if;
  if m.status <> 'draft' then
    raise exception 'match % not in draft status', p_match_id;
  end if;

  -- Derived fields
  perform public.recompute_match_derived(p_match_id);

  -- ===== SEASON rating =====
  insert into public.rating_state (is_lifetime, season_id, player_id, rate, games_played)
  select
    false,
    m.season_id,
    mr.player_id,
    coalesce(prev.rate, 1500),
    coalesce(prev.games_played, 0)
  from public.match_results mr
  left join lateral (
    select rs_prev.rate, rs_prev.games_played
    from public.rating_state rs_prev
    join public.seasons s_prev on s_prev.id = rs_prev.season_id
    join public.seasons s_cur on s_cur.id = m.season_id
    where rs_prev.is_lifetime = false
      and rs_prev.player_id = mr.player_id
      and s_prev.end_date <= s_cur.start_date
    order by s_prev.end_date desc, s_prev.created_at desc
    limit 1
  ) prev on true
  where mr.match_id = p_match_id
  on conflict (season_id, player_id) where (is_lifetime = false) do nothing;

  select avg(rs.rate)::numeric into avg_rate
  from public.rating_state rs
  join public.match_results mr on mr.player_id = rs.player_id
  where rs.is_lifetime = false and rs.season_id = m.season_id and mr.match_id = p_match_id;

  for rec in
    select mr.player_id, mr.placement, rs.rate as old_rate, rs.games_played as n
    from public.match_results mr
    join public.rating_state rs
      on rs.is_lifetime = false and rs.season_id = m.season_id and rs.player_id = mr.player_id
    where mr.match_id = p_match_id
  loop
    declare d numeric;
    declare new_r numeric;
    begin
      d := public.games_adjustment(rec.n)
           * ( public.place_base_points(rec.placement)
               + ((avg_rate - rec.old_rate) / 40.0) );
      new_r := rec.old_rate + d;

      insert into public.rating_events (
        is_lifetime, season_id, match_id, player_id, placement,
        old_rate, delta, new_rate, games_played_before
      ) values (
        false, m.season_id, p_match_id, rec.player_id, rec.placement,
        rec.old_rate, d, new_r, rec.n
      );

      update public.rating_state
      set games_played = games_played + 1,
          rate = new_r,
          updated_at = now()
      where is_lifetime = false and season_id = m.season_id and player_id = rec.player_id;
    end;
  end loop;

  -- ===== LIFETIME rating (optional) =====
  if p_update_lifetime then
    insert into public.rating_state (is_lifetime, season_id, player_id)
    select true, null, mr.player_id
    from public.match_results mr
    where mr.match_id = p_match_id
    on conflict (player_id) where (is_lifetime = true) do nothing;

    select avg(rs.rate)::numeric into avg_rate
    from public.rating_state rs
    join public.match_results mr on mr.player_id = rs.player_id
    where rs.is_lifetime = true and mr.match_id = p_match_id;

    for rec in
      select mr.player_id, mr.placement, rs.rate as old_rate, rs.games_played as n
      from public.match_results mr
      join public.rating_state rs
        on rs.is_lifetime = true and rs.player_id = mr.player_id
      where mr.match_id = p_match_id
    loop
      declare d2 numeric;
      declare new_r2 numeric;
      begin
        d2 := public.games_adjustment(rec.n)
              * ( public.place_base_points(rec.placement)
                  + ((avg_rate - rec.old_rate) / 40.0) );
        new_r2 := rec.old_rate + d2;

        insert into public.rating_events (
          is_lifetime, season_id, match_id, player_id, placement,
          old_rate, delta, new_rate, games_played_before
        ) values (
          true, null, p_match_id, rec.player_id, rec.placement,
          rec.old_rate, d2, new_r2, rec.n
        );

        update public.rating_state
        set games_played = games_played + 1,
            rate = new_r2,
            updated_at = now()
        where is_lifetime = true and player_id = rec.player_id;
      end;
    end loop;
  end if;

  update public.matches set status = 'final' where id = p_match_id;
end;
$$;

revoke all on function public.finalize_match(uuid, boolean) from public;
grant execute on function public.finalize_match(uuid, boolean) to authenticated;

-- Recompute season ratings from scratch (does NOT touch lifetime)
create or replace function public.recompute_season_ratings(p_season_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  mid uuid;
  m public.matches;
  rec record;
  avg_rate numeric;
  season_start date;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only';
  end if;

  select s.start_date into season_start
  from public.seasons s
  where s.id = p_season_id;
  if season_start is null then
    raise exception 'season % not found', p_season_id;
  end if;

  delete from public.rating_events where is_lifetime = false and season_id = p_season_id;
  delete from public.rating_state  where is_lifetime = false and season_id = p_season_id;

  for mid in
    select id
    from public.matches
    where season_id = p_season_id and status = 'final'
    order by played_at asc, id asc
  loop
    select * into m from public.matches where id = mid;

    -- ensure derived fields exist
    perform public.recompute_match_derived(mid);

    insert into public.rating_state (is_lifetime, season_id, player_id, rate, games_played)
    select
      false,
      p_season_id,
      mr.player_id,
      coalesce(prev.rate, 1500),
      coalesce(prev.games_played, 0)
    from public.match_results mr
    left join lateral (
      select rs_prev.rate, rs_prev.games_played
      from public.rating_state rs_prev
      join public.seasons s_prev on s_prev.id = rs_prev.season_id
      where rs_prev.is_lifetime = false
        and rs_prev.player_id = mr.player_id
        and s_prev.end_date <= season_start
      order by s_prev.end_date desc, s_prev.created_at desc
      limit 1
    ) prev on true
    where mr.match_id = mid
    on conflict (season_id, player_id) where (is_lifetime = false) do nothing;

    select avg(rs.rate)::numeric into avg_rate
    from public.rating_state rs
    join public.match_results mr on mr.player_id = rs.player_id
    where rs.is_lifetime = false and rs.season_id = p_season_id and mr.match_id = mid;

    for rec in
      select mr.player_id, mr.placement, rs.rate as old_rate, rs.games_played as n
      from public.match_results mr
      join public.rating_state rs
        on rs.is_lifetime = false and rs.season_id = p_season_id and rs.player_id = mr.player_id
      where mr.match_id = mid
    loop
      declare d numeric;
      declare new_r numeric;
      begin
        d := public.games_adjustment(rec.n)
             * ( public.place_base_points(rec.placement)
                 + ((avg_rate - rec.old_rate) / 40.0) );
        new_r := rec.old_rate + d;

        insert into public.rating_events (
          is_lifetime, season_id, match_id, player_id, placement,
          old_rate, delta, new_rate, games_played_before
        ) values (
          false, p_season_id, mid, rec.player_id, rec.placement,
          rec.old_rate, d, new_r, rec.n
        );

        update public.rating_state
        set games_played = games_played + 1,
            rate = new_r,
            updated_at = now()
        where is_lifetime = false and season_id = p_season_id and player_id = rec.player_id;
      end;
    end loop;
  end loop;
end;
$$;

revoke all on function public.recompute_season_ratings(uuid) from public;
grant execute on function public.recompute_season_ratings(uuid) to authenticated;

-- Recompute lifetime ratings from scratch (across all final matches)
create or replace function public.recompute_lifetime_ratings()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  mid uuid;
  rec record;
  avg_rate numeric;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only';
  end if;

  delete from public.rating_events where is_lifetime = true;
  delete from public.rating_state  where is_lifetime = true;

  for mid in
    select id
    from public.matches
    where status = 'final'
    order by played_at asc, id asc
  loop
    perform public.recompute_match_derived(mid);

    insert into public.rating_state (is_lifetime, season_id, player_id)
    select true, null, mr.player_id
    from public.match_results mr
    where mr.match_id = mid
    on conflict (player_id) where (is_lifetime = true) do nothing;

    select avg(rs.rate)::numeric into avg_rate
    from public.rating_state rs
    join public.match_results mr on mr.player_id = rs.player_id
    where rs.is_lifetime = true and mr.match_id = mid;

    for rec in
      select mr.player_id, mr.placement, rs.rate as old_rate, rs.games_played as n
      from public.match_results mr
      join public.rating_state rs
        on rs.is_lifetime = true and rs.player_id = mr.player_id
      where mr.match_id = mid
    loop
      declare d numeric;
      declare new_r numeric;
      begin
        d := public.games_adjustment(rec.n)
             * ( public.place_base_points(rec.placement)
                 + ((avg_rate - rec.old_rate) / 40.0) );
        new_r := rec.old_rate + d;

        insert into public.rating_events (
          is_lifetime, season_id, match_id, player_id, placement,
          old_rate, delta, new_rate, games_played_before
        ) values (
          true, null, mid, rec.player_id, rec.placement,
          rec.old_rate, d, new_r, rec.n
        );

        update public.rating_state
        set games_played = games_played + 1,
            rate = new_r,
            updated_at = now()
        where is_lifetime = true and player_id = rec.player_id;
      end;
    end loop;
  end loop;
end;
$$;

revoke all on function public.recompute_lifetime_ratings() from public;
grant execute on function public.recompute_lifetime_ratings() to authenticated;

-- 6) SECURITY: RLS + GRANTS

alter table public.seasons enable row level security;
alter table public.players enable row level security;
alter table public.player_accounts enable row level security;
alter table public.rulesets enable row level security;
alter table public.matches enable row level security;
alter table public.match_results enable row level security;
alter table public.adjustments enable row level security;
alter table public.rating_state enable row level security;
alter table public.rating_events enable row level security;

-- profiles: user can read/update self; admin can read/update all
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id or public.is_admin((select auth.uid())));

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id or public.is_admin((select auth.uid())))
with check ((select auth.uid()) = id or public.is_admin((select auth.uid())));

-- player_accounts: user can see self mapping; admin can see/write all
drop policy if exists player_accounts_select on public.player_accounts;
create policy player_accounts_select
on public.player_accounts
for select
to authenticated
using ((select auth.uid()) = auth_user_id or public.is_admin((select auth.uid())));

drop policy if exists player_accounts_admin_write on public.player_accounts;
drop policy if exists player_accounts_admin_insert on public.player_accounts;
create policy player_accounts_admin_insert
on public.player_accounts
for insert
to authenticated
with check (public.admin_only());

drop policy if exists player_accounts_admin_update on public.player_accounts;
create policy player_accounts_admin_update
on public.player_accounts
for update
to authenticated
using (public.admin_only())
with check (public.admin_only());

drop policy if exists player_accounts_admin_delete on public.player_accounts;
create policy player_accounts_admin_delete
on public.player_accounts
for delete
to authenticated
using (public.admin_only());

-- Player self-service display settings update
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

-- public readable tables
drop policy if exists seasons_public_read on public.seasons;
create policy seasons_public_read
on public.seasons
for select
to anon, authenticated
using (true);

drop policy if exists players_public_read on public.players;
create policy players_public_read
on public.players
for select
to anon, authenticated
using (true);

drop policy if exists rulesets_public_read on public.rulesets;
create policy rulesets_public_read
on public.rulesets
for select
to anon, authenticated
using (true);

-- hide drafts from public
drop policy if exists matches_public_read on public.matches;
create policy matches_public_read
on public.matches
for select
to anon, authenticated
using (status = 'final');

drop policy if exists results_public_read on public.match_results;
create policy results_public_read
on public.match_results
for select
to anon, authenticated
using (
  exists (select 1 from public.matches m where m.id = match_id and m.status = 'final')
);

drop policy if exists adjustments_public_read on public.adjustments;
create policy adjustments_public_read
on public.adjustments
for select
to anon, authenticated
using (true);

drop policy if exists rating_state_public_read on public.rating_state;
create policy rating_state_public_read
on public.rating_state
for select
to anon, authenticated
using (true);

drop policy if exists rating_events_public_read on public.rating_events;
create policy rating_events_public_read
on public.rating_events
for select
to anon, authenticated
using (true);

-- admin-only write policies
create or replace function public.admin_only()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin((select auth.uid()));
$$;

revoke all on function public.admin_only() from public;
grant execute on function public.admin_only() to authenticated;

drop policy if exists seasons_admin_write on public.seasons;
drop policy if exists seasons_admin_insert on public.seasons;
create policy seasons_admin_insert on public.seasons
for insert to authenticated
with check (public.admin_only());

drop policy if exists seasons_admin_update on public.seasons;
create policy seasons_admin_update on public.seasons
for update to authenticated
using (public.admin_only()) with check (public.admin_only());

drop policy if exists seasons_admin_delete on public.seasons;
create policy seasons_admin_delete on public.seasons
for delete to authenticated
using (public.admin_only());

drop policy if exists players_admin_write on public.players;
drop policy if exists players_admin_insert on public.players;
create policy players_admin_insert on public.players
for insert to authenticated
with check (public.admin_only());

drop policy if exists players_admin_update on public.players;
create policy players_admin_update on public.players
for update to authenticated
using (public.admin_only()) with check (public.admin_only());

drop policy if exists players_admin_delete on public.players;
create policy players_admin_delete on public.players
for delete to authenticated
using (public.admin_only());

drop policy if exists rulesets_admin_write on public.rulesets;
drop policy if exists rulesets_admin_insert on public.rulesets;
create policy rulesets_admin_insert on public.rulesets
for insert to authenticated
with check (public.admin_only());

drop policy if exists rulesets_admin_update on public.rulesets;
create policy rulesets_admin_update on public.rulesets
for update to authenticated
using (public.admin_only()) with check (public.admin_only());

drop policy if exists rulesets_admin_delete on public.rulesets;
create policy rulesets_admin_delete on public.rulesets
for delete to authenticated
using (public.admin_only());

drop policy if exists matches_admin_write on public.matches;
drop policy if exists matches_admin_insert on public.matches;
create policy matches_admin_insert on public.matches
for insert to authenticated
with check (public.admin_only());

drop policy if exists matches_admin_update on public.matches;
create policy matches_admin_update on public.matches
for update to authenticated
using (public.admin_only()) with check (public.admin_only());

drop policy if exists matches_admin_delete on public.matches;
create policy matches_admin_delete on public.matches
for delete to authenticated
using (public.admin_only());

drop policy if exists match_results_admin_write on public.match_results;
drop policy if exists match_results_admin_insert on public.match_results;
create policy match_results_admin_insert on public.match_results
for insert to authenticated
with check (public.admin_only());

drop policy if exists match_results_admin_update on public.match_results;
create policy match_results_admin_update on public.match_results
for update to authenticated
using (public.admin_only()) with check (public.admin_only());

drop policy if exists match_results_admin_delete on public.match_results;
create policy match_results_admin_delete on public.match_results
for delete to authenticated
using (public.admin_only());

drop policy if exists adjustments_admin_write on public.adjustments;
drop policy if exists adjustments_admin_insert on public.adjustments;
create policy adjustments_admin_insert on public.adjustments
for insert to authenticated
with check (public.admin_only());

drop policy if exists adjustments_admin_update on public.adjustments;
create policy adjustments_admin_update on public.adjustments
for update to authenticated
using (public.admin_only()) with check (public.admin_only());

drop policy if exists adjustments_admin_delete on public.adjustments;
create policy adjustments_admin_delete on public.adjustments
for delete to authenticated
using (public.admin_only());

drop policy if exists rating_state_admin_write on public.rating_state;
drop policy if exists rating_state_admin_insert on public.rating_state;
create policy rating_state_admin_insert on public.rating_state
for insert to authenticated
with check (public.admin_only());

drop policy if exists rating_state_admin_update on public.rating_state;
create policy rating_state_admin_update on public.rating_state
for update to authenticated
using (public.admin_only()) with check (public.admin_only());

drop policy if exists rating_state_admin_delete on public.rating_state;
create policy rating_state_admin_delete on public.rating_state
for delete to authenticated
using (public.admin_only());

drop policy if exists rating_events_admin_write on public.rating_events;
drop policy if exists rating_events_admin_insert on public.rating_events;
create policy rating_events_admin_insert on public.rating_events
for insert to authenticated
with check (public.admin_only());

drop policy if exists rating_events_admin_update on public.rating_events;
create policy rating_events_admin_update on public.rating_events
for update to authenticated
using (public.admin_only()) with check (public.admin_only());

drop policy if exists rating_events_admin_delete on public.rating_events;
create policy rating_events_admin_delete on public.rating_events
for delete to authenticated
using (public.admin_only());

-- grants (needed in addition to RLS)
grant usage on schema public to anon, authenticated;

grant select on public.seasons, public.players, public.rulesets to anon, authenticated;
grant select on public.matches, public.match_results, public.adjustments to anon, authenticated;
grant select on public.rating_state, public.rating_events to anon, authenticated;

grant insert, update, delete on public.seasons, public.players, public.rulesets to authenticated;
grant insert, update, delete on public.matches, public.match_results, public.adjustments to authenticated;
grant insert, update, delete on public.rating_state, public.rating_events to authenticated;
grant insert, update, delete on public.player_accounts to authenticated;

grant select, insert, update, delete on public.profiles to authenticated;

-- 7) SECURITY INVOKER views (public analytics)

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

-- Standings (season cumulative + rank; includes adjustments)
create or replace view public.v_season_standings
with (security_invoker = true)
as
with base as (
  select
    season_id,
    player_id,
    display_name,
    count(*) as games_played,
    sum(club_points) as total_points,
    avg(placement::numeric) as avg_placement,
    avg(club_points) as avg_points,
    sum((placement = 1)::int) as firsts,
    sum((placement = 2)::int) as seconds,
    sum((placement = 3)::int) as thirds,
    sum((placement = 4)::int) as fourths,
    sum((placement <= 2)::int)::numeric / greatest(count(*)::numeric, 1) as top2_rate,
    sum((placement = 4)::int)::numeric / greatest(count(*)::numeric, 1) as fourth_rate,
    sum((tobi)::int)::numeric / greatest(count(*)::numeric, 1) as tobi_rate
  from public.v_final_results
  group by season_id, player_id, display_name
),
adj as (
  select season_id, player_id, sum(points) as adj_points
  from public.adjustments
  group by season_id, player_id
)
select
  b.*,
  coalesce(a.adj_points, 0) as adjustment_points,
  (b.total_points + coalesce(a.adj_points, 0)) as total_points_with_adjustments,
  dense_rank() over (partition by b.season_id order by (b.total_points + coalesce(a.adj_points, 0)) desc) as rank
from base b
left join adj a
  on a.season_id = b.season_id and a.player_id = b.player_id;

-- Player stats per season (includes requested fields + extras)
create or replace view public.v_season_player_stats
with (security_invoker = true)
as
with g as (
  select
    season_id,
    player_id,
    display_name,
    match_id,
    played_at,
    placement,
    club_points
  from public.v_final_results
),
agg as (
  select
    season_id,
    player_id,
    display_name,
    count(*) as games_played,
    sum(club_points) as total_points,
    avg(placement::numeric) as avg_placement,
    avg(club_points) as avg_points,
    sum((placement = 1)::int) as firsts,
    sum((placement = 2)::int) as seconds,
    sum((placement = 3)::int) as thirds,
    sum((placement = 4)::int) as fourths,
    sum((placement <= 2)::int)::numeric / greatest(count(*)::numeric, 1) as top2_rate,
    sum((placement = 1)::int)::numeric / greatest(count(*)::numeric, 1) as first_rate,
    sum((placement = 4)::int)::numeric / greatest(count(*)::numeric, 1) as fourth_rate,
    stddev_pop(club_points) as stdev_points,
    percentile_cont(0.5) within group (order by club_points) as median_points,
    max(club_points) as best_points,
    min(club_points) as worst_points,
    max(played_at) as last_played_at
  from g
  group by season_id, player_id, display_name
),
best as (
  select distinct on (season_id, player_id)
    season_id, player_id, match_id as best_match_id, played_at as best_played_at
  from g
  order by season_id, player_id, club_points desc, played_at desc, match_id desc
),
worst as (
  select distinct on (season_id, player_id)
    season_id, player_id, match_id as worst_match_id, played_at as worst_played_at
  from g
  order by season_id, player_id, club_points asc, played_at desc, match_id desc
)
select
  a.*,
  b.best_match_id, b.best_played_at,
  w.worst_match_id, w.worst_played_at
from agg a
left join best b on b.season_id = a.season_id and b.player_id = a.player_id
left join worst w on w.season_id = a.season_id and w.player_id = a.player_id;

create or replace view public.v_player_match_history
with (security_invoker = true)
as
select
  season_id,
  player_id,
  display_name,
  played_at,
  match_id,
  seat,
  raw_points,
  club_points,
  placement,
  tobi
from public.v_final_results;

create or replace view public.v_player_point_history
with (security_invoker = true)
as
select
  season_id,
  player_id,
  display_name,
  played_at,
  match_id,
  club_points,
  sum(club_points) over (
    partition by season_id, player_id
    order by played_at asc, match_id asc
    rows between unbounded preceding and current row
  ) as cumulative_points
from public.v_final_results;

create or replace view public.v_player_placement_history
with (security_invoker = true)
as
select
  season_id,
  player_id,
  display_name,
  played_at,
  match_id,
  placement
from public.v_final_results;

-- Current ratings (season + lifetime)
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

-- Rating history (season + lifetime)
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

grant select on public.v_final_results to anon, authenticated;
grant select on public.v_season_standings to anon, authenticated;
grant select on public.v_season_player_stats to anon, authenticated;
grant select on public.v_player_match_history to anon, authenticated;
grant select on public.v_player_point_history to anon, authenticated;
grant select on public.v_player_placement_history to anon, authenticated;
grant select on public.v_current_ratings to anon, authenticated;
grant select on public.v_rating_history to anon, authenticated;

-- 8) Seed one default ruleset (optional)
insert into public.rulesets (name)
values ('Default 25/25, Uma 30/10/-10/-30')
on conflict (name) do nothing;
