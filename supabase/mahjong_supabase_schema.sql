-- Mahjong Club (Supabase/Postgres) schema v1.2
-- Fresh-install baseline only. Run against a Supabase project that does not
-- already contain these application objects; this is not an upgrade script.
-- Supports:
-- - Seasons (semester-style)
-- - Players (separate from auth accounts; public-friendly)
-- - Matches with 4 seats (E/S/W/N) and raw end points
-- - Derived club points (return + uma + oka) stored at finalize-time
-- - Tenhou-like R rating per season AND lifetime, with rating history
-- - Public read for non-admin data; admin-only writes (RLS)
--
-- Notes:
-- - Analytics views use SECURITY INVOKER (Postgres 15+). v_public_players is
--   an owner-executed view that exposes only an explicit redacted projection.

-- 0) Extensions
create extension if not exists pgcrypto;

-- 1) Auth profiles (admin flag lives here)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

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

-- Centralized policy/RPC guard. Trusted database administrators retain an
-- override; application calls must come from an existing admin profile.
create or replace function public.admin_only()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    session_user in ('postgres', 'supabase_admin')
    or public.is_admin((select auth.uid()));
$$;

revoke all on function public.admin_only() from public;
grant execute on function public.admin_only() to authenticated;

-- 2) Core domain tables

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  start_date date not null,
  end_date date not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  constraint seasons_date_order_check check (start_date <= end_date)
);

-- There can be only one season selected as the application default.
create unique index seasons_one_active_idx
on public.seasons (is_active)
where is_active;

create table public.players (
  id uuid primary key default gen_random_uuid(),
  display_name text unique,
  real_first_name text,
  real_last_name text,
  show_display_name boolean not null default true,
  show_real_first_name boolean not null default false,
  show_real_last_name boolean not null default false,
  profile_message_md text,
  profile_media_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint players_name_presence_check check (
    nullif(trim(display_name), '') is not null
    or nullif(trim(real_first_name), '') is not null
  ),
  constraint players_visible_name_choice_check
    check (show_display_name or show_real_first_name),
  constraint players_display_flag_has_value_check
    check ((not show_display_name) or nullif(trim(display_name), '') is not null),
  constraint players_first_flag_has_value_check
    check ((not show_real_first_name) or nullif(trim(real_first_name), '') is not null),
  constraint players_last_flag_has_value_check
    check ((not show_real_last_name) or nullif(trim(real_last_name), '') is not null)
);

-- Optional admin-managed mapping from an auth account to a player identity
create table public.player_accounts (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (player_id)
);

-- Rulesets
create table public.rulesets (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  start_points int not null default 25000,
  return_points int not null default 25000,
  point_divisor int not null default 1000,
  uma_1 numeric not null default 30,
  uma_2 numeric not null default 10,
  uma_3 numeric not null default -10,
  uma_4 numeric not null default -30,
  oka_1 numeric not null default 0,
  oka_2 numeric not null default 0,
  oka_3 numeric not null default 0,
  oka_4 numeric not null default 0,
  created_at timestamptz not null default now(),
  constraint rulesets_positive_values_check
    check (start_points > 0 and return_points > 0 and point_divisor > 0)
);

-- Enums
create type public.match_status as enum ('draft','final','void');
create type public.seat as enum ('E','S','W','N');
create type public.table_mode as enum ('A','M');

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete restrict,
  ruleset_id uuid not null references public.rulesets(id) on delete restrict,
  game_number int,
  table_mode public.table_mode,
  extra_sticks int not null default 0,
  include_in_lifetime_rating boolean not null default true,
  played_at timestamptz not null,
  status public.match_status not null default 'draft',
  table_label text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint matches_game_number_check check (game_number is null or game_number > 0),
  constraint matches_extra_sticks_check check (extra_sticks >= 0),
  constraint matches_game_metadata_pair_check check ((game_number is null) = (table_mode is null))
);
create index matches_season_played_idx on public.matches (season_id, played_at desc);
create index matches_created_by_idx on public.matches (created_by);
create index matches_ruleset_id_idx on public.matches (ruleset_id);

create unique index matches_season_day_game_table_unique
on public.matches (
  season_id,
  ((played_at at time zone 'America/Phoenix')::date),
  game_number,
  table_mode
)
where status <> 'void' and game_number is not null and table_mode is not null;

-- Cross-table checks cannot be expressed as CHECK constraints. This trigger
-- keeps a match on a day belonging to its season and provides a race-safe
-- fallback for the business-key uniqueness enforced by the index above.
create or replace function public.validate_match_metadata()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_start date;
  v_end date;
  v_played_date date;
  v_key text;
begin
  select s.start_date, s.end_date
  into v_start, v_end
  from public.seasons s
  where s.id = new.season_id;

  if not found then
    raise exception 'season % not found', new.season_id;
  end if;

  v_played_date := (new.played_at at time zone 'America/Phoenix')::date;
  if v_played_date < v_start or v_played_date > v_end then
    raise exception 'match date % is outside season range % through %',
      v_played_date, v_start, v_end;
  end if;

  if new.status <> 'void' and new.game_number is not null and new.table_mode is not null then
    v_key := new.season_id::text || '|' || v_played_date::text || '|'
      || new.game_number::text || '|' || new.table_mode::text;
    perform pg_advisory_xact_lock(hashtextextended(v_key, 0));

    if exists (
      select 1
      from public.matches m
      where m.id <> new.id
        and m.season_id = new.season_id
        and (m.played_at at time zone 'America/Phoenix')::date = v_played_date
        and m.game_number = new.game_number
        and m.table_mode = new.table_mode
        and m.status <> 'void'
    ) then
      raise exception 'a non-void match already exists for season %, date %, game %, table %',
        new.season_id, v_played_date, new.game_number, new.table_mode;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_match_metadata() from public;

create trigger matches_validate_metadata
before insert or update of season_id, played_at, game_number, table_mode, status
on public.matches
for each row execute function public.validate_match_metadata();

-- Season identity/date changes can invalidate match dates, the lifetime epoch,
-- and rating carry order. Keep them immutable; create a replacement season for
-- corrections. (is_active remains freely changeable.)
create or replace function public.guard_season_identity_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (old.name, old.start_date, old.end_date)
       is distinct from
     (new.name, new.start_date, new.end_date) then
    raise exception 'season name and dates are immutable; create a replacement season';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_season_identity_update() from public;

create trigger seasons_guard_identity_update
before update of name, start_date, end_date on public.seasons
for each row execute function public.guard_season_identity_update();

create table public.match_results (
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
create index match_results_player_idx on public.match_results (player_id);
create index match_results_match_idx on public.match_results (match_id);

-- Lock the parent draft before any score/identity mutation. This closes the
-- race where a concurrent save could otherwise land while finalize_match is
-- reading the four rows.
create or replace function public.guard_match_result_write()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_match_id uuid;
  v_status public.match_status;
begin
  if tg_op = 'DELETE' then
    v_match_id := old.match_id;
  else
    v_match_id := new.match_id;
  end if;

  if tg_op = 'DELETE'
     and current_setting('azriichi.allow_match_delete', true) = 'on' then
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if new.match_id <> old.match_id then
      raise exception 'moving a result between matches is not allowed';
    end if;
  end if;

  select m.status into v_status
  from public.matches m
  where m.id = v_match_id
  for update;

  -- A cascading parent delete has already made the match invisible here.
  if not found and tg_op = 'DELETE' then
    return old;
  end if;
  if not found then
    raise exception 'match % not found', v_match_id;
  end if;
  if v_status <> 'draft' then
    raise exception 'results for match % cannot be edited after draft', v_match_id;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  -- Any score/identity edit invalidates previously previewed derived values.
  new.placement := null;
  new.club_points := null;
  new.tobi := false;
  return new;
end;
$$;

revoke all on function public.guard_match_result_write() from public;

create trigger match_results_guard_write
before insert or delete or update of match_id, seat, player_id, raw_points
on public.match_results
for each row execute function public.guard_match_result_write();

create or replace function public.guard_match_result_derived_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_setting('azriichi.allow_derived_update', true) is distinct from 'on' then
    raise exception 'placement, club points, and tobi are database-derived';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_match_result_derived_write() from public;

create trigger match_results_guard_derived_write
before update of placement, club_points, tobi on public.match_results
for each row execute function public.guard_match_result_derived_write();

create or replace function public.guard_final_match_metadata()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status <> 'draft' then
    raise exception 'final or void match metadata cannot be edited';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_final_match_metadata() from public;

create trigger matches_guard_final_metadata
before update of season_id, ruleset_id, played_at, game_number, table_mode, extra_sticks, include_in_lifetime_rating
on public.matches
for each row execute function public.guard_final_match_metadata();

create or replace function public.guard_match_status_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'matches must be inserted as drafts';
    end if;
    return new;
  end if;

  if old.status is distinct from new.status
     and current_setting('azriichi.allow_match_finalize', true) is distinct from 'on' then
    raise exception 'match status must be changed through a rating-safe RPC';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_match_status_transition() from public;

create trigger matches_guard_status_transition
before insert or update of status on public.matches
for each row execute function public.guard_match_status_transition();

create or replace function public.guard_published_match_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_setting('azriichi.allow_match_delete', true) is distinct from 'on' then
    raise exception 'matches must be deleted with delete_match_and_recompute';
  end if;
  return old;
end;
$$;

revoke all on function public.guard_published_match_delete() from public;

create trigger matches_guard_published_delete
before delete on public.matches
for each row execute function public.guard_published_match_delete();

create table public.adjustments (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  points numeric not null,
  reason text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index adjustments_season_player_idx on public.adjustments (season_id, player_id);
create index adjustments_created_by_idx on public.adjustments (created_by);
create index adjustments_player_id_idx on public.adjustments (player_id);

-- 3) Tenhou-like rating (season + lifetime)

-- rating_state:
-- - is_lifetime=false: per-season rating, season_id required
-- - is_lifetime=true: lifetime rating, season_id must be NULL
create table public.rating_state (
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
create unique index rating_state_unique_season
on public.rating_state (season_id, player_id)
where is_lifetime = false;

create unique index rating_state_unique_lifetime
on public.rating_state (player_id)
where is_lifetime = true;

create table public.rating_events (
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

create unique index rating_events_unique_season
on public.rating_events (season_id, match_id, player_id)
where is_lifetime = false;

create unique index rating_events_unique_lifetime
on public.rating_events (match_id, player_id)
where is_lifetime = true;

create index rating_events_player_idx on public.rating_events (player_id, created_at desc);

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

  -- Never fall back to a component the player chose to hide.
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
    when n <= 20 then greatest(1 - (0.04::numeric * n::numeric), 0.2)
    else 0.2
  end;
$$;

-- Lifetime R intentionally begins with Spring 2026. Keeping the lookup in one
-- helper makes finalization and full rebuilds use identical boundaries.
create or replace function public.lifetime_rating_start_date()
returns date
language sql
stable
set search_path = public
as $$
  select coalesce(
    (
      select s.start_date
      from public.seasons s
      where lower(trim(s.name)) like 'spring 2026%'
      order by s.start_date asc, s.id asc
      limit 1
    ),
    date '2026-01-01'
  );
$$;

revoke all on function public.lifetime_rating_start_date() from public;

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
  if not public.admin_only() then
    raise exception 'admin only';
  end if;

  lock table public.match_results in share row exclusive mode;

  -- Direct result writes lock child rows before their parent in the write
  -- trigger. Use the same deterministic order here to avoid lock inversion.
  perform mr.seat
  from public.match_results mr
  where mr.match_id = p_match_id
  order by public.seat_priority(mr.seat)
  for update;

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

  perform set_config('azriichi.allow_derived_update', 'on', true);

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
  lifetime_start date;
  match_season_start date;
  has_later_final boolean;
  raw_total bigint;
  expected_total bigint;
begin
  if not public.admin_only() then
    raise exception 'admin only';
  end if;

  -- Rating state is global (four players can overlap any two matches), so row
  -- locks alone cannot prevent lost updates. Serialize every rating mutation.
  perform pg_advisory_xact_lock(734221, 1);
  lock table public.match_results in share row exclusive mode;

  perform mr.seat
  from public.match_results mr
  where mr.match_id = p_match_id
  order by public.seat_priority(mr.seat)
  for update;

  select * into m from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'match % not found', p_match_id;
  end if;
  if m.status <> 'draft' then
    raise exception 'match % not in draft status', p_match_id;
  end if;

  select s.start_date, public.lifetime_rating_start_date()
  into match_season_start, lifetime_start
  from public.seasons s
  where s.id = m.season_id;

  -- Validates exactly four distinct seats/players before any rating mutation.
  perform public.recompute_match_derived(p_match_id);

  select coalesce(sum(mr.raw_points), 0), (r.start_points::bigint * 4)
  into raw_total, expected_total
  from public.rulesets r
  left join public.match_results mr on mr.match_id = p_match_id
  where r.id = m.ruleset_id
  group by r.start_points;

  if raw_total + m.extra_sticks::bigint <> expected_total then
    raise exception
      'match % point total is unbalanced: raw total % + extra points % must equal %',
      p_match_id, raw_total, m.extra_sticks, expected_total;
  end if;

  select exists (
    select 1
    from public.matches later
    where later.status = 'final'
      and (later.played_at, later.id) > (m.played_at, m.id)
  )
  into has_later_final;

  -- A historical insertion changes every downstream average. Publish it, then
  -- rebuild deterministically instead of applying it to today's state.
  if has_later_final then
    perform set_config('azriichi.allow_match_finalize', 'on', true);
    update public.matches
    set status = 'final', include_in_lifetime_rating = coalesce(p_update_lifetime, false)
    where id = p_match_id;
    perform public.recompute_all_ratings();
    return;
  end if;

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
  if p_update_lifetime
     and match_season_start is not null
     and match_season_start >= lifetime_start then
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

  perform set_config('azriichi.allow_match_finalize', 'on', true);
  update public.matches
  set status = 'final', include_in_lifetime_rating = coalesce(p_update_lifetime, false)
  where id = p_match_id;
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
  if not public.admin_only() then
    raise exception 'admin only';
  end if;

  perform pg_advisory_xact_lock(734221, 1);
  lock table public.match_results in share row exclusive mode;

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
revoke execute on function public.recompute_season_ratings(uuid) from anon, authenticated;

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
  lifetime_start date;
begin
  if not public.admin_only() then
    raise exception 'admin only';
  end if;

  perform pg_advisory_xact_lock(734221, 1);
  lifetime_start := public.lifetime_rating_start_date();

  delete from public.rating_events where is_lifetime = true;
  delete from public.rating_state  where is_lifetime = true;

  for mid in
    select m.id
    from public.matches m
    join public.seasons s on s.id = m.season_id
    where m.status = 'final'
      and m.include_in_lifetime_rating
      and s.start_date >= lifetime_start
    order by m.played_at asc, m.id asc
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
revoke execute on function public.recompute_lifetime_ratings() from anon, authenticated;

-- Rebuild every season in chronological order so the carried starting R for
-- later seasons cannot remain stale, then rebuild the lifetime scope using the
-- same match ordering and start boundary.
create or replace function public.recompute_all_ratings()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  sid uuid;
begin
  if not public.admin_only() then
    raise exception 'admin only';
  end if;

  perform pg_advisory_xact_lock(734221, 1);
  lock table public.match_results in share row exclusive mode;

  delete from public.rating_events where is_lifetime = false;
  delete from public.rating_state where is_lifetime = false;

  for sid in
    select s.id
    from public.seasons s
    order by s.start_date asc, s.end_date asc, s.id asc
  loop
    perform public.recompute_season_ratings(sid);
  end loop;

  perform public.recompute_lifetime_ratings();
end;
$$;

revoke all on function public.recompute_all_ratings() from public;
grant execute on function public.recompute_all_ratings() to authenticated;

-- Create-and-activate is one transaction, so a failed insert cannot leave the
-- deployment with no active season.
create or replace function public.create_season(
  p_name text,
  p_start_date date,
  p_end_date date,
  p_is_active boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.admin_only() then
    raise exception 'admin only';
  end if;

  if nullif(trim(p_name), '') is null then
    raise exception 'season name is required';
  end if;
  if p_start_date is null or p_end_date is null or p_start_date > p_end_date then
    raise exception 'season date range is invalid';
  end if;

  perform pg_advisory_xact_lock(734221, 2);

  if coalesce(p_is_active, false) then
    update public.seasons set is_active = false where is_active;
  end if;

  insert into public.seasons (name, start_date, end_date, is_active)
  values (trim(p_name), p_start_date, p_end_date, coalesce(p_is_active, false))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_season(text, date, date, boolean) from public;
grant execute on function public.create_season(text, date, date, boolean) to authenticated;

-- Delete the match, match-scoped CHOMBO adjustments, and all affected rating
-- state atomically.
create or replace function public.delete_match_and_recompute(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.matches;
  needs_rebuild boolean;
begin
  if not public.admin_only() then
    raise exception 'admin only';
  end if;

  perform pg_advisory_xact_lock(734221, 1);
  lock table public.match_results in share row exclusive mode;

  perform mr.seat
  from public.match_results mr
  where mr.match_id = p_match_id
  order by public.seat_priority(mr.seat)
  for update;

  select * into m
  from public.matches
  where id = p_match_id
  for update;

  if not found then
    raise exception 'match % not found', p_match_id;
  end if;

  needs_rebuild := m.status = 'final' or exists (
    select 1 from public.rating_events re where re.match_id = p_match_id
  );

  delete from public.adjustments a
  where a.season_id = m.season_id
    and a.reason like ('CHOMBO:' || p_match_id::text || ':%');

  perform set_config('azriichi.allow_match_delete', 'on', true);
  delete from public.matches where id = p_match_id;

  if needs_rebuild then
    perform public.recompute_all_ratings();
  end if;
end;
$$;

revoke all on function public.delete_match_and_recompute(uuid) from public;
grant execute on function public.delete_match_and_recompute(uuid) to authenticated;

-- Atomically unlink/relink both unique sides of an account-to-player mapping.
create or replace function public.set_player_account_link(
  p_player_id uuid,
  p_auth_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.admin_only() then
    raise exception 'admin only';
  end if;

  perform pg_advisory_xact_lock(734221, 3);

  if not exists (select 1 from public.players p where p.id = p_player_id) then
    raise exception 'player % not found', p_player_id;
  end if;

  if p_auth_user_id is null then
    delete from public.player_accounts pa where pa.player_id = p_player_id;
    return;
  end if;

  if not exists (select 1 from public.profiles p where p.id = p_auth_user_id) then
    raise exception 'auth profile % not found', p_auth_user_id;
  end if;

  delete from public.player_accounts pa
  where pa.player_id = p_player_id or pa.auth_user_id = p_auth_user_id;

  insert into public.player_accounts (auth_user_id, player_id)
  values (p_auth_user_id, p_player_id);
end;
$$;

revoke all on function public.set_player_account_link(uuid, uuid) from public;
grant execute on function public.set_player_account_link(uuid, uuid) to authenticated;

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

-- profiles: users can read their own profile; only an existing admin can
-- update profile rows (especially is_admin).
create policy profiles_select_self
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id or public.is_admin((select auth.uid())));

create policy profiles_admin_update
on public.profiles
for update
to authenticated
using (public.admin_only())
with check (public.admin_only());

-- player_accounts: user can see self mapping; admin can see/write all
create policy player_accounts_select
on public.player_accounts
for select
to authenticated
using ((select auth.uid()) = auth_user_id or public.is_admin((select auth.uid())));

create policy player_accounts_admin_insert
on public.player_accounts
for insert
to authenticated
with check (public.admin_only());

create policy player_accounts_admin_update
on public.player_accounts
for update
to authenticated
using (public.admin_only())
with check (public.admin_only());

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

create or replace function public.update_my_player_profile(
  p_display_name text default null,
  p_real_first_name text default null,
  p_real_last_name text default null,
  p_show_display_name boolean default true,
  p_show_real_first_name boolean default false,
  p_show_real_last_name boolean default false,
  p_profile_message_md text default null,
  p_profile_media_url text default null
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
    show_real_last_name = coalesce(p_show_real_last_name, false),
    profile_message_md = nullif(trim(p_profile_message_md), ''),
    profile_media_url = nullif(trim(p_profile_media_url), '')
  where id = v_player_id;

  return v_player_id;
end;
$$;

revoke all on function public.update_my_player_profile(text, text, text, boolean, boolean, boolean, text, text) from public;
grant execute on function public.update_my_player_profile(text, text, text, boolean, boolean, boolean, text, text) to authenticated;

-- Safe public player projection. The owner executes the view so callers never
-- need base-table access, and private name components are physically absent
-- (NULL) from the result rather than relying on application formatting.
create or replace view public.v_public_players
with (security_invoker = false, security_barrier = true)
as
select
  p.id,
  case when p.show_display_name then p.display_name end as display_name,
  case when p.show_real_first_name then p.real_first_name end as real_first_name,
  case when p.show_real_last_name then p.real_last_name end as real_last_name,
  p.show_display_name,
  p.show_real_first_name,
  p.show_real_last_name,
  public.player_public_name(p.*) as public_name,
  p.profile_message_md,
  p.profile_media_url,
  p.is_active,
  p.created_at
from public.players p;

-- Public tables/projections
create policy seasons_public_read
on public.seasons
for select
to anon, authenticated
using (true);

create policy players_private_read
on public.players
for select
to authenticated
using (
  public.admin_only()
  or exists (
    select 1
    from public.player_accounts pa
    where pa.auth_user_id = (select auth.uid())
      and pa.player_id = players.id
  )
);

create policy rulesets_public_read
on public.rulesets
for select
to anon, authenticated
using (true);

-- hide drafts from public
create policy matches_public_read
on public.matches
for select
to anon, authenticated
using (status = 'final');

create policy results_public_read
on public.match_results
for select
to anon, authenticated
using (
  exists (select 1 from public.matches m where m.id = match_id and m.status = 'final')
);

create policy adjustments_public_read
on public.adjustments
for select
to anon, authenticated
using (true);

create policy rating_state_public_read
on public.rating_state
for select
to anon, authenticated
using (true);

create policy rating_events_public_read
on public.rating_events
for select
to anon, authenticated
using (true);

-- admin-only write policies
create policy matches_admin_select on public.matches
for select to authenticated
using (public.admin_only());

create policy match_results_admin_select on public.match_results
for select to authenticated
using (public.admin_only());

create policy seasons_admin_insert on public.seasons
for insert to authenticated
with check (public.admin_only());

create policy seasons_admin_update on public.seasons
for update to authenticated
using (public.admin_only()) with check (public.admin_only());

create policy seasons_admin_delete on public.seasons
for delete to authenticated
using (public.admin_only());

create policy players_admin_insert on public.players
for insert to authenticated
with check (public.admin_only());

create policy players_admin_update on public.players
for update to authenticated
using (public.admin_only()) with check (public.admin_only());

create policy players_admin_delete on public.players
for delete to authenticated
using (public.admin_only());

create policy rulesets_admin_insert on public.rulesets
for insert to authenticated
with check (public.admin_only());

create policy rulesets_admin_update on public.rulesets
for update to authenticated
using (public.admin_only()) with check (public.admin_only());

create policy rulesets_admin_delete on public.rulesets
for delete to authenticated
using (public.admin_only());

create policy matches_admin_insert on public.matches
for insert to authenticated
with check (public.admin_only());

create policy matches_admin_update on public.matches
for update to authenticated
using (public.admin_only()) with check (public.admin_only());

create policy matches_admin_delete on public.matches
for delete to authenticated
using (public.admin_only());

create policy match_results_admin_insert on public.match_results
for insert to authenticated
with check (public.admin_only());

create policy match_results_admin_update on public.match_results
for update to authenticated
using (public.admin_only()) with check (public.admin_only());

create policy match_results_admin_delete on public.match_results
for delete to authenticated
using (public.admin_only());

create policy adjustments_admin_insert on public.adjustments
for insert to authenticated
with check (public.admin_only());

create policy adjustments_admin_update on public.adjustments
for update to authenticated
using (public.admin_only()) with check (public.admin_only());

create policy adjustments_admin_delete on public.adjustments
for delete to authenticated
using (public.admin_only());

create policy rating_state_admin_insert on public.rating_state
for insert to authenticated
with check (public.admin_only());

create policy rating_state_admin_update on public.rating_state
for update to authenticated
using (public.admin_only()) with check (public.admin_only());

create policy rating_state_admin_delete on public.rating_state
for delete to authenticated
using (public.admin_only());

create policy rating_events_admin_insert on public.rating_events
for insert to authenticated
with check (public.admin_only());

create policy rating_events_admin_update on public.rating_events
for update to authenticated
using (public.admin_only()) with check (public.admin_only());

create policy rating_events_admin_delete on public.rating_events
for delete to authenticated
using (public.admin_only());

-- grants (needed in addition to RLS)
grant usage on schema public to anon, authenticated;

grant select on public.seasons, public.rulesets to anon, authenticated;
revoke select on public.players from public, anon;
grant select on public.players to authenticated;
grant select on public.v_public_players to anon, authenticated;
grant select on public.matches, public.match_results, public.adjustments to anon, authenticated;
grant select on public.rating_state, public.rating_events to anon, authenticated;

grant insert, update, delete on public.seasons, public.players, public.rulesets to authenticated;
grant insert, update, delete on public.matches, public.match_results, public.adjustments to authenticated;
grant insert, update, delete on public.rating_state, public.rating_events to authenticated;
grant select on public.player_accounts to authenticated;
grant insert, update, delete on public.player_accounts to authenticated;

revoke insert, delete on public.profiles from authenticated;
grant select, update on public.profiles to authenticated;

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
  p.public_name as display_name,
  r.raw_points,
  r.club_points,
  r.placement,
  r.tobi
from public.matches m
join public.match_results r on r.match_id = m.id
join public.v_public_players p on p.id = r.player_id
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
  p.public_name as display_name,
  rs.rate,
  rs.games_played,
  rs.updated_at
from public.rating_state rs
join public.v_public_players p on p.id = rs.player_id;

-- Rating history (season + lifetime)
create or replace view public.v_rating_history
with (security_invoker = true)
as
select
  re.is_lifetime,
  re.season_id,
  re.player_id,
  p.public_name as display_name,
  m.played_at,
  re.match_id,
  re.placement,
  re.old_rate,
  re.delta,
  re.new_rate,
  re.games_played_before
from public.rating_events re
join public.matches m on m.id = re.match_id
join public.v_public_players p on p.id = re.player_id
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
insert into public.rulesets (
  name, start_points, return_points, point_divisor,
  uma_1, uma_2, uma_3, uma_4,
  oka_1, oka_2, oka_3, oka_4
)
values (
  'Default 25/25, Uma 30/10/-10/-30', 25000, 25000, 1000,
  30, 10, -10, -30,
  0, 0, 0, 0
);
