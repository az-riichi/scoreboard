-- Mahjong Club (Supabase/Postgres) schema v1.2
-- Fresh-install baseline only. Run against a Supabase project that does not
-- already contain these application objects; this is not an upgrade script.
-- Supports:
-- - Dated competitive seasons plus one timeless Casual category
-- - Players (separate from auth accounts; public-friendly)
-- - Matches with 4 seats (E/S/W/N) and raw end points
-- - Derived club points (return + uma + oka) stored at finalize-time
-- - Tenhou-like R rating per season AND lifetime, with rating history
-- - Public read for non-admin data; admin-only writes (RLS)
--
-- Notes:
-- - Public analytics are derived in the browser from raw finalized records.
--   v_public_players is an owner-executed privacy projection that exposes only
--   explicitly redacted fields.

-- 0) Extensions
create extension if not exists pgcrypto;

-- 1) Auth profiles (admin flag lives here)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  is_admin boolean not null default false,
  admin_role text not null default 'user',
  admin_permissions text[] not null default '{}'::text[],
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
  start_date date,
  end_date date,
  is_casual boolean not null default false,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  constraint seasons_kind_dates_check check (
    (is_casual and start_date is null and end_date is null and not is_active)
    or
    ((not is_casual) and start_date is not null and end_date is not null and start_date <= end_date)
  )
);

-- There can be only one season selected as the application default.
create unique index seasons_one_active_idx
on public.seasons (is_active)
where is_active;

-- Casual is a singleton, timeless pseudo-season. It can coexist with the
-- dated season selected as the application default.
create unique index seasons_one_casual_idx
on public.seasons (is_casual)
where is_casual;

insert into public.seasons (name, start_date, end_date, is_casual, is_active)
values ('Casual', null, null, true, false);

create table public.casual_events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint casual_events_name_check check (
    name = btrim(name)
    and char_length(name) between 1 and 100
  )
);

create unique index casual_events_name_lower_unique
on public.casual_events (lower(name));

create index casual_events_created_by_idx
on public.casual_events (created_by);

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
create type public.discipline_action_type as enum ('strike', 'suspension', 'ban');
create type public.discipline_action_source as enum ('manual', 'automatic');

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete restrict,
  casual_event_id uuid references public.casual_events(id) on delete restrict,
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
  created_via_import boolean not null default false,
  created_at timestamptz not null default now(),
  constraint matches_game_number_check check (game_number is null or game_number > 0),
  constraint matches_extra_sticks_check check (extra_sticks >= 0),
  constraint matches_game_metadata_pair_check check ((game_number is null) = (table_mode is null))
);
create index matches_season_played_idx on public.matches (season_id, played_at desc);
create index matches_created_by_idx on public.matches (created_by);
create index matches_ruleset_id_idx on public.matches (ruleset_id);
create index matches_casual_event_played_idx
on public.matches (casual_event_id, played_at desc)
where casual_event_id is not null;

-- Supports same-season referential integrity for match-linked adjustments.
create unique index matches_season_id_id_unique
on public.matches (season_id, id);

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
  v_is_casual boolean;
  v_played_date date;
  v_key text;
begin
  select s.start_date, s.end_date, s.is_casual
  into v_start, v_end, v_is_casual
  from public.seasons s
  where s.id = new.season_id;

  if not found then
    raise exception 'season % not found', new.season_id;
  end if;

  if new.casual_event_id is not null and not v_is_casual then
    raise exception 'casual events can only be assigned to Casual matches';
  end if;

  v_played_date := (new.played_at at time zone 'America/Phoenix')::date;
  if v_is_casual then
    -- This flag is persisted for deterministic lifetime rebuilds. Casual is
    -- never rating eligible, regardless of what a client sends.
    new.include_in_lifetime_rating := false;
  elsif v_played_date < v_start or v_played_date > v_end then
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
before insert or update of season_id, played_at, game_number, table_mode, status,
  include_in_lifetime_rating, casual_event_id
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
  if (old.name, old.start_date, old.end_date, old.is_casual)
       is distinct from
     (new.name, new.start_date, new.end_date, new.is_casual) then
    raise exception 'season name, dates, and kind are immutable; create a replacement season';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_season_identity_update() from public;

create trigger seasons_guard_identity_update
before update of name, start_date, end_date, is_casual on public.seasons
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
  if old.status <> 'draft'
     and current_setting('azriichi.allow_final_metadata_repair', true) is distinct from 'on' then
    raise exception 'final or void match metadata cannot be edited';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_final_match_metadata() from public;

create trigger matches_guard_final_metadata
before update of season_id, ruleset_id, played_at, game_number, table_mode,
  extra_sticks, include_in_lifetime_rating, casual_event_id
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
  match_id uuid,
  player_id uuid not null references public.players(id) on delete cascade,
  points numeric not null,
  reason text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint adjustments_season_match_fk
    foreign key (season_id, match_id)
    references public.matches (season_id, id)
    on delete cascade
);
create index adjustments_season_player_idx on public.adjustments (season_id, player_id);
create index adjustments_created_by_idx on public.adjustments (created_by);
create index adjustments_player_id_idx on public.adjustments (player_id);
create index adjustments_match_id_idx
on public.adjustments (match_id)
where match_id is not null;

-- Cheap public snapshot invalidation. Readers may inspect this singleton, but
-- only the trigger functions below can advance it.
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

-- Private, auditable discipline ledger. Revocations retain the original row;
-- automatic rows point to the strike/suspension that triggered escalation.
create table public.discipline_actions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete restrict,
  action_type public.discipline_action_type not null,
  reason text not null,
  match_id uuid references public.matches(id) on delete set null,
  issued_at timestamptz not null default now(),
  effective_on date not null,
  expires_on date,
  source public.discipline_action_source not null default 'manual',
  trigger_action_id uuid references public.discipline_actions(id) on delete restrict,
  issued_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  revocation_reason text,
  constraint discipline_actions_reason_check
    check (nullif(btrim(reason), '') is not null and char_length(reason) <= 2000),
  constraint discipline_actions_expiration_check
    check (
      (action_type = 'strike' and expires_on is not null and expires_on = effective_on + 29)
      or (action_type = 'suspension' and expires_on is not null and expires_on = effective_on + 13)
      or (action_type = 'ban' and expires_on is null)
    ),
  constraint discipline_actions_source_trigger_check
    check (
      (source = 'manual' and trigger_action_id is null)
      or (source = 'automatic' and trigger_action_id is not null)
    ),
  constraint discipline_actions_trigger_not_self_check
    check (trigger_action_id is null or trigger_action_id <> id),
  constraint discipline_actions_revocation_check
    check (
      (revoked_at is null and revoked_by is null and revocation_reason is null)
      or (
        revoked_at is not null
        and revoked_at >= issued_at
        and nullif(btrim(revocation_reason), '') is not null
        and char_length(revocation_reason) <= 2000
      )
    )
);

create unique index discipline_actions_trigger_action_unique
on public.discipline_actions (trigger_action_id)
where trigger_action_id is not null;

create index discipline_actions_player_issued_idx
on public.discipline_actions (player_id, issued_at desc);

create index discipline_actions_player_effective_idx
on public.discipline_actions (player_id, effective_on, expires_on)
where revoked_at is null;

create index discipline_actions_match_id_idx
on public.discipline_actions (match_id);

create index discipline_actions_issued_by_idx
on public.discipline_actions (issued_by);

create index discipline_actions_revoked_by_idx
on public.discipline_actions (revoked_by);

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
      where not s.is_casual
        and lower(trim(s.name)) like 'spring 2026%'
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
  match_season_is_casual boolean;
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

  select s.start_date, s.is_casual, public.lifetime_rating_start_date()
  into match_season_start, match_season_is_casual, lifetime_start
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

  -- A Casual match keeps its placements and score-derived statistics, but it
  -- never creates season or lifetime rating state/events.
  if match_season_is_casual then
    perform set_config('azriichi.allow_match_finalize', 'on', true);
    update public.matches
    set status = 'final', include_in_lifetime_rating = false
    where id = p_match_id;
    return;
  end if;

  select exists (
    select 1
    from public.matches later
    join public.seasons later_season on later_season.id = later.season_id
    where later.status = 'final'
      and not later_season.is_casual
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
      and not s_prev.is_casual
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
  season_is_casual boolean;
begin
  if not public.admin_only() then
    raise exception 'admin only';
  end if;

  perform pg_advisory_xact_lock(734221, 1);
  lock table public.match_results in share row exclusive mode;

  select s.start_date, s.is_casual into season_start, season_is_casual
  from public.seasons s
  where s.id = p_season_id;
  if not found then
    raise exception 'season % not found', p_season_id;
  end if;

  delete from public.rating_events where is_lifetime = false and season_id = p_season_id;
  delete from public.rating_state  where is_lifetime = false and season_id = p_season_id;

  -- Clearing legacy rows is intentional, but Casual never rebuilds a rating
  -- scope of its own.
  if season_is_casual then
    return;
  end if;

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
        and not s_prev.is_casual
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
      and not s.is_casual
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
    where not s.is_casual
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

  insert into public.seasons (name, start_date, end_date, is_casual, is_active)
  values (trim(p_name), p_start_date, p_end_date, false, coalesce(p_is_active, false))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_season(text, date, date, boolean) from public;
grant execute on function public.create_season(text, date, date, boolean) to authenticated;

create or replace function public.get_or_create_casual_event(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid;
begin
  if not public.admin_only() then
    raise exception 'admin only';
  end if;

  if char_length(v_name) < 1 or char_length(v_name) > 100 then
    raise exception 'event name must be between 1 and 100 characters';
  end if;

  select ce.id into v_id
  from public.casual_events ce
  where lower(ce.name) = lower(v_name)
  order by ce.id
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  insert into public.casual_events (name, created_by)
  values (v_name, (select auth.uid()))
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    select ce.id into v_id
    from public.casual_events ce
    where lower(ce.name) = lower(v_name)
    order by ce.id
    limit 1;
  end if;

  if v_id is null then
    raise exception 'could not create casual event';
  end if;

  return v_id;
end;
$$;

revoke all on function public.get_or_create_casual_event(text) from public;
grant execute on function public.get_or_create_casual_event(text) to authenticated;

create or replace function public.set_casual_match_event(
  p_match_id uuid,
  p_casual_event_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season_id uuid;
  v_is_casual boolean;
begin
  if not public.admin_only() then
    raise exception 'admin only';
  end if;

  select m.season_id
  into v_season_id
  from public.matches m
  where m.id = p_match_id
  for update;

  if not found then
    raise exception 'match % not found', p_match_id;
  end if;

  select s.is_casual
  into v_is_casual
  from public.seasons s
  where s.id = v_season_id;

  if not coalesce(v_is_casual, false) then
    raise exception 'events can only be assigned to Casual matches';
  end if;

  if p_casual_event_id is not null
     and not exists (
       select 1
       from public.casual_events ce
       where ce.id = p_casual_event_id
     ) then
    raise exception 'casual event % not found', p_casual_event_id;
  end if;

  perform set_config('azriichi.allow_final_metadata_repair', 'on', true);
  update public.matches
  set casual_event_id = p_casual_event_id
  where id = p_match_id;
  perform set_config('azriichi.allow_final_metadata_repair', 'off', true);
end;
$$;

revoke all on function public.set_casual_match_event(uuid, uuid) from public;
grant execute on function public.set_casual_match_event(uuid, uuid) to authenticated;

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
  match_is_casual boolean;
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

  select s.is_casual into match_is_casual
  from public.seasons s
  where s.id = m.season_id;

  needs_rebuild := (m.status = 'final' and not match_is_casual) or exists (
    select 1 from public.rating_events re where re.match_id = p_match_id
  );

  delete from public.adjustments a
  where a.match_id = p_match_id
     or (
       a.match_id is null
       and a.season_id = m.season_id
       and a.reason like ('CHOMBO:' || p_match_id::text || ':%')
     );

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

-- Issue a manual action at the server clock and atomically create any required
-- automatic suspension/ban descendants. Rules use Arizona calendar dates.
create or replace function public.issue_discipline_action(
  p_player_id uuid,
  p_action_type text,
  p_reason text,
  p_match_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action_type public.discipline_action_type;
  v_reason text;
  v_issued_at timestamptz := now();
  v_effective_on date;
  v_expires_on date;
  v_issued_by uuid := auth.uid();
  v_action_id uuid;
  v_suspension_id uuid;
  v_automatic_suspension_id uuid;
  v_ban_id uuid;
  v_same_day_strikes int;
  v_rolling_strikes int;
  v_suspension_count int;
  v_suspension_reason text;
begin
  if not public.admin_only() then
    raise exception 'admin only';
  end if;

  if p_player_id is null then
    raise exception 'player is required';
  end if;

  case lower(btrim(coalesce(p_action_type, '')))
    when 'strike' then v_action_type := 'strike';
    when 'suspension' then v_action_type := 'suspension';
    when 'ban' then v_action_type := 'ban';
    else raise exception 'action type must be strike, suspension, or ban';
  end case;

  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' then
    raise exception 'reason is required';
  end if;

  -- Threshold counts and automatic descendants must be serialized per player.
  perform pg_advisory_xact_lock(
    hashtextextended('discipline:' || p_player_id::text, 0)
  );

  if not exists (select 1 from public.players p where p.id = p_player_id) then
    raise exception 'player % not found', p_player_id;
  end if;

  if p_match_id is not null
     and not exists (select 1 from public.matches m where m.id = p_match_id) then
    raise exception 'match % not found', p_match_id;
  end if;

  -- Issue time is intentionally server-controlled. Rules operate on Arizona
  -- calendar dates, while issued_at preserves the exact audit timestamp.
  v_effective_on := (v_issued_at at time zone 'America/Phoenix')::date;
  v_expires_on := case v_action_type
    when 'strike' then v_effective_on + 29
    when 'suspension' then v_effective_on + 13
    else null
  end;

  insert into public.discipline_actions (
    player_id,
    action_type,
    reason,
    match_id,
    issued_at,
    effective_on,
    expires_on,
    source,
    issued_by
  ) values (
    p_player_id,
    v_action_type,
    v_reason,
    p_match_id,
    v_issued_at,
    v_effective_on,
    v_expires_on,
    'manual',
    v_issued_by
  )
  returning id into v_action_id;

  if v_action_type = 'strike' then
    select count(*)::int
    into v_same_day_strikes
    from public.discipline_actions da
    where da.player_id = p_player_id
      and da.action_type = 'strike'
      and da.revoked_at is null
      and da.effective_on = v_effective_on;

    select count(*)::int
    into v_rolling_strikes
    from public.discipline_actions da
    where da.player_id = p_player_id
      and da.action_type = 'strike'
      and da.revoked_at is null
      and da.effective_on between v_effective_on - 29 and v_effective_on;

    if (v_same_day_strikes > 2 or v_rolling_strikes > 5)
       and not exists (
         select 1
         from public.discipline_actions da
         where da.player_id = p_player_id
           and da.action_type = 'suspension'
           and da.revoked_at is null
           and da.effective_on <= v_effective_on
           and da.expires_on >= v_effective_on
       ) then
      v_suspension_reason := case
        when v_same_day_strikes > 2 and v_rolling_strikes > 5 then
          'Automatic suspension: daily and rolling 30-day strike thresholds exceeded'
        when v_same_day_strikes > 2 then
          'Automatic suspension: daily strike threshold exceeded'
        else
          'Automatic suspension: rolling 30-day strike threshold exceeded'
      end;

      insert into public.discipline_actions (
        player_id,
        action_type,
        reason,
        match_id,
        issued_at,
        effective_on,
        expires_on,
        source,
        trigger_action_id,
        issued_by
      ) values (
        p_player_id,
        'suspension',
        v_suspension_reason,
        p_match_id,
        v_issued_at,
        v_effective_on,
        v_effective_on + 13,
        'automatic',
        v_action_id,
        v_issued_by
      )
      returning id into v_suspension_id;
      v_automatic_suspension_id := v_suspension_id;
    end if;
  elsif v_action_type = 'suspension' then
    v_suspension_id := v_action_id;
  end if;

  if v_suspension_id is not null then
    select count(*)::int
    into v_suspension_count
    from public.discipline_actions da
    where da.player_id = p_player_id
      and da.action_type = 'suspension'
      and da.revoked_at is null;

    if v_suspension_count > 2
       and not exists (
         select 1
         from public.discipline_actions da
         where da.player_id = p_player_id
           and da.action_type = 'ban'
           and da.revoked_at is null
       ) then
      insert into public.discipline_actions (
        player_id,
        action_type,
        reason,
        match_id,
        issued_at,
        effective_on,
        expires_on,
        source,
        trigger_action_id,
        issued_by
      ) values (
        p_player_id,
        'ban',
        'Automatic ban: more than two non-revoked suspensions issued',
        p_match_id,
        v_issued_at,
        v_effective_on,
        null,
        'automatic',
        v_suspension_id,
        v_issued_by
      )
      returning id into v_ban_id;
    end if;
  end if;

  return jsonb_build_object(
    'action_id', v_action_id,
    'automatic_suspension_id', v_automatic_suspension_id,
    'automatic_ban_id', v_ban_id
  );
end;
$$;

revoke all on function public.issue_discipline_action(uuid, text, text, uuid) from public;
grant execute on function public.issue_discipline_action(uuid, text, text, uuid) to authenticated;

create or replace function public.revoke_discipline_action(
  p_action_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id uuid;
  v_reason text;
  v_revoked_at timestamptz := now();
begin
  if not public.admin_only() then
    raise exception 'admin only';
  end if;

  if p_action_id is null then
    raise exception 'discipline action is required';
  end if;

  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' then
    raise exception 'revocation reason is required';
  end if;

  select da.player_id
  into v_player_id
  from public.discipline_actions da
  where da.id = p_action_id;

  if not found then
    raise exception 'discipline action % not found', p_action_id;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('discipline:' || v_player_id::text, 0)
  );

  update public.discipline_actions da
  set
    revoked_at = v_revoked_at,
    revoked_by = auth.uid(),
    revocation_reason = v_reason
  where da.id = p_action_id
    and da.revoked_at is null;

  if not found then
    raise exception 'discipline action % is already revoked', p_action_id;
  end if;

  return jsonb_build_object(
    'action_id', p_action_id,
    'revoked_at', v_revoked_at
  );
end;
$$;

revoke all on function public.revoke_discipline_action(uuid, text) from public;
grant execute on function public.revoke_discipline_action(uuid, text) to authenticated;

-- Internal assertion shared by result writes and match-date/status changes.
create or replace function public.assert_player_competitive_eligible(
  p_match_id uuid,
  p_player_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_played_on date;
  v_is_casual boolean;
  v_action_type public.discipline_action_type;
  v_expires_on date;
begin
  -- Serialize eligibility decisions with discipline issuance for this player.
  -- Match-wide checks acquire these locks in player-id order below.
  perform pg_advisory_xact_lock_shared(
    hashtextextended('discipline:' || p_player_id::text, 0)
  );

  select
    (m.played_at at time zone 'America/Phoenix')::date,
    s.is_casual
  into v_played_on, v_is_casual
  from public.matches m
  join public.seasons s on s.id = m.season_id
  where m.id = p_match_id;

  if not found then
    raise exception 'match % not found', p_match_id;
  end if;

  if v_is_casual then
    return;
  end if;

  select da.action_type, da.expires_on
  into v_action_type, v_expires_on
  from public.discipline_actions da
  where da.player_id = p_player_id
    and da.revoked_at is null
    and da.effective_on <= v_played_on
    and (
      da.action_type = 'ban'
      or (da.action_type = 'suspension' and da.expires_on >= v_played_on)
    )
  order by
    case da.action_type when 'ban' then 0 else 1 end,
    da.effective_on desc,
    da.issued_at desc,
    da.id desc
  limit 1;

  if v_action_type = 'ban' then
    raise exception 'player % is banned from competitive games on %',
      p_player_id, v_played_on;
  elsif v_action_type = 'suspension' then
    raise exception 'player % is suspended from competitive games on % (through %)',
      p_player_id, v_played_on, v_expires_on;
  end if;
end;
$$;

revoke all on function public.assert_player_competitive_eligible(uuid, uuid) from public;

create or replace function public.guard_match_result_discipline()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_player_competitive_eligible(new.match_id, new.player_id);
  return new;
end;
$$;

revoke all on function public.guard_match_result_discipline() from public;

-- The existing match-results guard runs first (trigger names are ordered), so
-- its draft/status locking behavior remains unchanged.
create trigger match_results_guard_write_discipline
before insert or update of match_id, player_id on public.match_results
for each row execute function public.guard_match_result_discipline();

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
    order by mr.player_id
  loop
    perform public.assert_player_competitive_eligible(new.id, v_player_id);
  end loop;

  return new;
end;
$$;

revoke all on function public.guard_match_discipline() from public;

-- Recheck existing seats when a draft's competitive date/season changes and
-- immediately before a status transition (including finalization) commits.
create trigger matches_guard_discipline
after update of season_id, played_at, status on public.matches
for each row
when (
  old.season_id is distinct from new.season_id
  or old.played_at is distinct from new.played_at
  or old.status is distinct from new.status
)
execute function public.guard_match_discipline();

-- 6) SECURITY: RLS + GRANTS

alter table public.seasons enable row level security;
alter table public.casual_events enable row level security;
alter table public.players enable row level security;
alter table public.player_accounts enable row level security;
alter table public.rulesets enable row level security;
alter table public.matches enable row level security;
alter table public.match_results enable row level security;
alter table public.adjustments enable row level security;
alter table public.public_data_revision enable row level security;
alter table public.discipline_actions enable row level security;
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

-- Discipline records are private to administrators and the linked affected
-- player. All mutations go through the audited admin-only RPCs above.
create policy discipline_actions_select
on public.discipline_actions
for select
to authenticated
using (
  public.admin_only()
  or exists (
    select 1
    from public.player_accounts pa
    where pa.auth_user_id = (select auth.uid())
      and pa.player_id = discipline_actions.player_id
  )
);

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

create policy casual_events_public_read
on public.casual_events
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

create policy public_data_revision_public_read
on public.public_data_revision
for select
to anon, authenticated
using (scope = 'scoreboard');

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

create policy casual_events_admin_insert on public.casual_events
for insert to authenticated
with check (public.admin_only());

create policy casual_events_admin_update on public.casual_events
for update to authenticated
using (public.admin_only()) with check (public.admin_only());

create policy casual_events_admin_delete on public.casual_events
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

grant select on public.seasons, public.casual_events, public.rulesets to anon, authenticated;
revoke select on public.players from public, anon;
grant select on public.players to authenticated;
grant select on public.v_public_players to anon, authenticated;
grant select on public.matches, public.match_results, public.adjustments to anon, authenticated;
revoke all on public.public_data_revision from public, anon, authenticated;
grant select on public.public_data_revision to anon, authenticated;
grant select on public.rating_state, public.rating_events to anon, authenticated;

grant insert, update, delete on public.seasons, public.casual_events, public.players, public.rulesets to authenticated;
grant insert, update, delete on public.matches, public.match_results, public.adjustments to authenticated;
grant insert, update, delete on public.rating_state, public.rating_events to authenticated;
grant select on public.player_accounts to authenticated;
grant insert, update, delete on public.player_accounts to authenticated;

revoke all on public.discipline_actions from public, anon, authenticated;
grant select on public.discipline_actions to authenticated;

revoke insert, delete on public.profiles from authenticated;
grant select, update on public.profiles to authenticated;

-- Public analytics are derived from the versioned raw snapshot in the browser.

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

-- 9) GRANULAR ADMINISTRATOR AUTHORIZATION
--
-- Existing administrators become super administrators. No owner is selected
-- automatically: bootstrap the intended owner explicitly from the SQL editor
-- after this schema has been installed.

create or replace function public.valid_admin_permissions(p_permissions text[])
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(
    p_permissions <@ array[
      'add_matches',
      'remove_matches',
      'import_matches',
      'manage_match_penalties',
      'recompute_ratings',
      'add_players',
      'edit_players',
      'remove_players',
      'manage_player_accounts',
      'manage_seasons',
      'manage_discipline',
      'manage_permissions'
    ]::text[]
    and array_position(p_permissions, null) is null
    and cardinality(p_permissions) = (
      select count(distinct item.permission)::int
      from unnest(p_permissions) as item(permission)
    ),
    false
  );
$$;

revoke all on function public.valid_admin_permissions(text[]) from public, anon, authenticated;

alter table public.profiles
  add column if not exists admin_role text not null default 'user',
  add column if not exists admin_permissions text[] not null default '{}'::text[];

alter table public.matches
  add column if not exists created_via_import boolean not null default false;

update public.profiles
set admin_role = 'super_admin'
where is_admin
  and admin_role = 'user'
  and cardinality(admin_permissions) = 0;

update public.profiles
set admin_role = 'admin'
where admin_role = 'user'
  and cardinality(admin_permissions) > 0;

update public.profiles
set is_admin = (
  admin_role <> 'user'
  or cardinality(admin_permissions) > 0
);

alter table public.profiles
  alter column admin_role set default 'user',
  alter column admin_role set not null,
  alter column admin_permissions set default '{}'::text[],
  alter column admin_permissions set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_admin_role_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_admin_role_check
      check (admin_role in ('user', 'admin', 'super_admin', 'owner'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_admin_permissions_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_admin_permissions_check
      check (public.valid_admin_permissions(admin_permissions));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_admin_role_permissions_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_admin_role_permissions_check
      check (
        (admin_role = 'user' and cardinality(admin_permissions) = 0)
        or (admin_role = 'admin' and cardinality(admin_permissions) > 0)
        or admin_role in ('super_admin', 'owner')
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_is_admin_mirror_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_is_admin_mirror_check
      check (is_admin = (admin_role <> 'user'));
  end if;
end $$;

create or replace function public.sync_profile_admin_mirror()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.is_admin := new.admin_role <> 'user';
  return new;
end;
$$;

revoke all on function public.sync_profile_admin_mirror() from public, anon, authenticated;

drop trigger if exists profiles_sync_admin_mirror on public.profiles;
create trigger profiles_sync_admin_mirror
before insert or update of admin_role, admin_permissions, is_admin
on public.profiles
for each row execute function public.sync_profile_admin_mirror();

create or replace function public.has_admin_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_permission = any (array[
      'add_matches',
      'remove_matches',
      'import_matches',
      'manage_match_penalties',
      'recompute_ratings',
      'add_players',
      'edit_players',
      'remove_players',
      'manage_player_accounts',
      'manage_seasons',
      'manage_discipline',
      'manage_permissions'
    ]::text[])
    and coalesce(
      (
        select
          p.admin_role in ('super_admin', 'owner')
          or p.admin_permissions @> array[p_permission]::text[]
        from public.profiles p
        where p.id = (select auth.uid())
      ),
      false
    );
$$;

revoke all on function public.has_admin_permission(text) from public, anon, authenticated;
grant execute on function public.has_admin_permission(text) to authenticated;

create or replace function public.is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select
        p.admin_role <> 'user'
        or cardinality(p.admin_permissions) > 0
      from public.profiles p
      where p.id = uid
    ),
    false
  );
$$;

revoke all on function public.is_admin(uuid) from public, anon;
grant execute on function public.is_admin(uuid) to authenticated;

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

revoke all on function public.admin_only() from public, anon;
grant execute on function public.admin_only() to authenticated;

-- Actor and target UUIDs intentionally have no cascading foreign keys: an
-- access audit must retain both identities after an auth account is deleted.
create table if not exists public.admin_access_audit (
  id bigint generated always as identity primary key,
  actor_user_id uuid,
  target_user_id uuid not null,
  old_role text not null,
  new_role text not null,
  old_permissions text[] not null,
  new_permissions text[] not null,
  changed_at timestamptz not null default now(),
  constraint admin_access_audit_old_role_check
    check (old_role in ('user', 'admin', 'super_admin', 'owner')),
  constraint admin_access_audit_new_role_check
    check (new_role in ('user', 'admin', 'super_admin', 'owner')),
  constraint admin_access_audit_old_permissions_check
    check (public.valid_admin_permissions(old_permissions)),
  constraint admin_access_audit_new_permissions_check
    check (public.valid_admin_permissions(new_permissions))
);

create index if not exists admin_access_audit_target_changed_idx
on public.admin_access_audit (target_user_id, changed_at desc);

create index if not exists admin_access_audit_actor_changed_idx
on public.admin_access_audit (actor_user_id, changed_at desc);

alter table public.admin_access_audit enable row level security;

drop policy if exists admin_access_audit_select on public.admin_access_audit;
create policy admin_access_audit_select
on public.admin_access_audit
for select
to authenticated
using (public.has_admin_permission('manage_permissions'));

revoke all on public.admin_access_audit from public, anon, authenticated;
grant select on public.admin_access_audit to authenticated;

create or replace function public.set_admin_access(
  p_target_user_id uuid,
  p_permissions text[],
  p_super_admin boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_actor_role text;
  v_actor_permissions text[];
  v_target_role text;
  v_target_permissions text[];
  v_permissions text[] := coalesce(p_permissions, '{}'::text[]);
  v_new_role text;
begin
  if v_actor_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if p_target_user_id is null then
    raise exception 'target user is required';
  end if;

  if p_target_user_id = v_actor_user_id then
    raise exception 'administrators cannot change their own access'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(734221, 4);

  select p.admin_role, p.admin_permissions
  into v_actor_role, v_actor_permissions
  from public.profiles p
  where p.id = v_actor_user_id
  for share;

  if not found
     or not (
       v_actor_role in ('super_admin', 'owner')
       or v_actor_permissions @> array['manage_permissions']::text[]
     ) then
    raise exception 'missing permission: manage_permissions'
      using errcode = '42501';
  end if;

  if not public.valid_admin_permissions(v_permissions) then
    raise exception 'permissions contain an unknown, null, or duplicate value';
  end if;

  select p.admin_role, p.admin_permissions
  into v_target_role, v_target_permissions
  from public.profiles p
  where p.id = p_target_user_id
  for update;

  if not found then
    raise exception 'target profile % not found', p_target_user_id;
  end if;

  if v_target_role = 'owner' then
    raise exception 'owner access cannot be changed here'
      using errcode = '42501';
  end if;

  if v_target_role = 'super_admin' and v_actor_role <> 'owner' then
    raise exception 'only an owner may change a super administrator'
      using errcode = '42501';
  end if;

  if coalesce(p_super_admin, false) and v_actor_role <> 'owner' then
    raise exception 'only an owner may grant super administrator access'
      using errcode = '42501';
  end if;

  v_new_role := case
    when coalesce(p_super_admin, false) then 'super_admin'
    when cardinality(v_permissions) > 0 then 'admin'
    else 'user'
  end;

  update public.profiles p
  set
    admin_role = v_new_role,
    admin_permissions = v_permissions
  where p.id = p_target_user_id;

  if v_target_role is distinct from v_new_role
     or v_target_permissions is distinct from v_permissions then
    insert into public.admin_access_audit (
      actor_user_id,
      target_user_id,
      old_role,
      new_role,
      old_permissions,
      new_permissions
    ) values (
      v_actor_user_id,
      p_target_user_id,
      v_target_role,
      v_new_role,
      v_target_permissions,
      v_permissions
    );
  end if;
end;
$$;

revoke all on function public.set_admin_access(uuid, text[], boolean) from public, anon, authenticated;
grant execute on function public.set_admin_access(uuid, text[], boolean) to authenticated;

create or replace function public.guard_match_provenance()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.created_by is distinct from new.created_by then
    raise exception 'match creator is immutable';
  end if;

  if old.created_via_import is distinct from new.created_via_import then
    raise exception 'match import provenance is immutable';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_match_provenance() from public, anon, authenticated;

drop trigger if exists matches_guard_provenance on public.matches;
create trigger matches_guard_provenance
before update of created_by, created_via_import
on public.matches
for each row execute function public.guard_match_provenance();

create or replace function public.guard_casual_event_provenance()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.created_by is distinct from new.created_by then
    raise exception 'casual event creator is immutable';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_casual_event_provenance() from public, anon, authenticated;

drop trigger if exists casual_events_guard_provenance on public.casual_events;
create trigger casual_events_guard_provenance
before update of created_by
on public.casual_events
for each row execute function public.guard_casual_event_provenance();

create or replace function public.guard_adjustment_provenance()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if session_user not in ('postgres', 'supabase_admin')
       and (
         new.created_by is null
         or new.created_by is distinct from (select auth.uid())
       ) then
      raise exception 'adjustment creator must be the authenticated user'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if old.created_by is distinct from new.created_by then
    raise exception 'adjustment creator is immutable';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_adjustment_provenance() from public, anon, authenticated;

drop trigger if exists adjustments_guard_provenance on public.adjustments;
create trigger adjustments_guard_provenance
before insert or update of created_by
on public.adjustments
for each row execute function public.guard_adjustment_provenance();

create or replace function public.guard_player_active_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.is_active is distinct from new.is_active
     and current_setting('azriichi.allow_player_active_update', true) is distinct from 'on' then
    raise exception 'player active status must be changed through set_player_active';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_player_active_update() from public, anon, authenticated;

drop trigger if exists players_guard_active_update on public.players;
create trigger players_guard_active_update
before update of is_active
on public.players
for each row execute function public.guard_player_active_update();

alter table public.profiles enable row level security;
alter table public.admin_access_audit enable row level security;
alter table public.seasons enable row level security;
alter table public.casual_events enable row level security;
alter table public.players enable row level security;
alter table public.player_accounts enable row level security;
alter table public.rulesets enable row level security;
alter table public.matches enable row level security;
alter table public.match_results enable row level security;
alter table public.adjustments enable row level security;
alter table public.public_data_revision enable row level security;
alter table public.discipline_actions enable row level security;
alter table public.rating_state enable row level security;
alter table public.rating_events enable row level security;

drop policy if exists profiles_select_authorized on public.profiles;
drop policy if exists player_accounts_select_authorized on public.player_accounts;
drop policy if exists players_insert_authorized on public.players;
drop policy if exists players_update_authorized on public.players;
drop policy if exists seasons_insert_authorized on public.seasons;
drop policy if exists seasons_update_authorized on public.seasons;
drop policy if exists seasons_delete_authorized on public.seasons;
drop policy if exists rulesets_insert_authorized on public.rulesets;
drop policy if exists rulesets_update_authorized on public.rulesets;
drop policy if exists rulesets_delete_authorized on public.rulesets;
drop policy if exists casual_events_insert_authorized on public.casual_events;
drop policy if exists casual_events_update_authorized on public.casual_events;
drop policy if exists casual_events_delete_authorized on public.casual_events;
drop policy if exists matches_insert_authorized on public.matches;
drop policy if exists matches_update_authorized on public.matches;
drop policy if exists match_results_insert_authorized on public.match_results;
drop policy if exists match_results_update_authorized on public.match_results;
drop policy if exists match_results_delete_authorized on public.match_results;
drop policy if exists adjustments_insert_authorized on public.adjustments;
drop policy if exists adjustments_update_authorized on public.adjustments;
drop policy if exists adjustments_delete_authorized on public.adjustments;

drop policy if exists profiles_select_self on public.profiles;
drop policy if exists profiles_update_self on public.profiles;
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_select_authorized
on public.profiles
for select
to authenticated
using (
  (select auth.uid()) = id
  or public.has_admin_permission('manage_permissions')
  or public.has_admin_permission('manage_player_accounts')
);

drop policy if exists player_accounts_select on public.player_accounts;
drop policy if exists player_accounts_admin_write on public.player_accounts;
drop policy if exists player_accounts_admin_insert on public.player_accounts;
drop policy if exists player_accounts_admin_update on public.player_accounts;
drop policy if exists player_accounts_admin_delete on public.player_accounts;
create policy player_accounts_select_authorized
on public.player_accounts
for select
to authenticated
using (
  (select auth.uid()) = auth_user_id
  or public.has_admin_permission('manage_player_accounts')
);

drop policy if exists players_public_read on public.players;
drop policy if exists players_private_read on public.players;
create policy players_private_read
on public.players
for select
to authenticated
using (
  exists (
    select 1
    from public.player_accounts pa
    where pa.auth_user_id = (select auth.uid())
      and pa.player_id = players.id
  )
  or public.has_admin_permission('add_matches')
  or public.has_admin_permission('remove_matches')
  or public.has_admin_permission('import_matches')
  or public.has_admin_permission('manage_match_penalties')
  or public.has_admin_permission('add_players')
  or public.has_admin_permission('edit_players')
  or public.has_admin_permission('remove_players')
  or public.has_admin_permission('manage_player_accounts')
  or public.has_admin_permission('manage_discipline')
);

drop policy if exists players_admin_write on public.players;
drop policy if exists players_admin_insert on public.players;
drop policy if exists players_admin_update on public.players;
drop policy if exists players_admin_delete on public.players;
create policy players_insert_authorized
on public.players
for insert
to authenticated
with check (public.has_admin_permission('add_players'));
create policy players_update_authorized
on public.players
for update
to authenticated
using (public.has_admin_permission('edit_players'))
with check (public.has_admin_permission('edit_players'));

drop policy if exists seasons_admin_write on public.seasons;
drop policy if exists seasons_admin_insert on public.seasons;
drop policy if exists seasons_admin_update on public.seasons;
drop policy if exists seasons_admin_delete on public.seasons;
create policy seasons_insert_authorized
on public.seasons
for insert
to authenticated
with check (public.has_admin_permission('manage_seasons'));
create policy seasons_update_authorized
on public.seasons
for update
to authenticated
using (public.has_admin_permission('manage_seasons'))
with check (public.has_admin_permission('manage_seasons'));
create policy seasons_delete_authorized
on public.seasons
for delete
to authenticated
using (public.has_admin_permission('manage_seasons'));

drop policy if exists rulesets_admin_write on public.rulesets;
drop policy if exists rulesets_admin_insert on public.rulesets;
drop policy if exists rulesets_admin_update on public.rulesets;
drop policy if exists rulesets_admin_delete on public.rulesets;

drop policy if exists casual_events_admin_write on public.casual_events;
drop policy if exists casual_events_admin_insert on public.casual_events;
drop policy if exists casual_events_admin_update on public.casual_events;
drop policy if exists casual_events_admin_delete on public.casual_events;

drop policy if exists matches_admin_select on public.matches;
create policy matches_admin_select
on public.matches
for select
to authenticated
using (
  public.has_admin_permission('add_matches')
  or public.has_admin_permission('remove_matches')
  or public.has_admin_permission('manage_match_penalties')
  or public.has_admin_permission('manage_discipline')
  or (
    public.has_admin_permission('import_matches')
    and created_via_import
    and created_by = (select auth.uid())
  )
);

drop policy if exists matches_admin_write on public.matches;
drop policy if exists matches_admin_insert on public.matches;
drop policy if exists matches_admin_update on public.matches;
drop policy if exists matches_admin_delete on public.matches;
create policy matches_insert_authorized
on public.matches
for insert
to authenticated
with check (
  status = 'draft'
  and created_by = (select auth.uid())
  and (
    (
      public.has_admin_permission('add_matches')
      and not created_via_import
    )
    or (
      public.has_admin_permission('import_matches')
      and created_via_import
    )
  )
);
create policy matches_update_authorized
on public.matches
for update
to authenticated
using (
  public.has_admin_permission('add_matches')
  and not created_via_import
)
with check (
  public.has_admin_permission('add_matches')
  and not created_via_import
);

drop policy if exists match_results_admin_select on public.match_results;
create policy match_results_admin_select
on public.match_results
for select
to authenticated
using (
  public.has_admin_permission('add_matches')
  or public.has_admin_permission('remove_matches')
  or public.has_admin_permission('manage_match_penalties')
  or (
    public.has_admin_permission('import_matches')
    and exists (
      select 1
      from public.matches m
      where m.id = match_results.match_id
        and m.status = 'draft'
        and m.created_via_import
        and m.created_by = (select auth.uid())
    )
  )
);

drop policy if exists match_results_admin_write on public.match_results;
drop policy if exists match_results_admin_insert on public.match_results;
drop policy if exists match_results_admin_update on public.match_results;
drop policy if exists match_results_admin_delete on public.match_results;
create policy match_results_insert_authorized
on public.match_results
for insert
to authenticated
with check (
  (
    public.has_admin_permission('add_matches')
    and exists (
      select 1
      from public.matches m
      where m.id = match_results.match_id
        and m.status = 'draft'
        and not m.created_via_import
    )
  )
  or (
    public.has_admin_permission('import_matches')
    and exists (
      select 1
      from public.matches m
      where m.id = match_results.match_id
        and m.status = 'draft'
        and m.created_via_import
        and m.created_by = (select auth.uid())
    )
  )
);
create policy match_results_update_authorized
on public.match_results
for update
to authenticated
using (
  public.has_admin_permission('add_matches')
  and exists (
    select 1
    from public.matches m
    where m.id = match_results.match_id
      and not m.created_via_import
  )
)
with check (
  public.has_admin_permission('add_matches')
  and exists (
    select 1
    from public.matches m
    where m.id = match_results.match_id
      and not m.created_via_import
  )
);
create policy match_results_delete_authorized
on public.match_results
for delete
to authenticated
using (
  public.has_admin_permission('add_matches')
  and exists (
    select 1
    from public.matches m
    where m.id = match_results.match_id
      and not m.created_via_import
  )
);

drop policy if exists adjustments_admin_write on public.adjustments;
drop policy if exists adjustments_admin_insert on public.adjustments;
drop policy if exists adjustments_admin_update on public.adjustments;
drop policy if exists adjustments_admin_delete on public.adjustments;
create policy adjustments_insert_authorized
on public.adjustments
for insert
to authenticated
with check (
  public.has_admin_permission('manage_match_penalties')
  and created_by = (select auth.uid())
  and match_id is not null
  and reason like ('CHOMBO:' || match_id::text || ':%')
  and exists (
    select 1
    from public.match_results mr
    where mr.match_id = adjustments.match_id
      and mr.player_id = adjustments.player_id
  )
);
create policy adjustments_delete_authorized
on public.adjustments
for delete
to authenticated
using (
  public.has_admin_permission('manage_match_penalties')
  and match_id is not null
  and reason like ('CHOMBO:' || match_id::text || ':%')
  and exists (
    select 1
    from public.match_results mr
    where mr.match_id = adjustments.match_id
      and mr.player_id = adjustments.player_id
  )
);

drop policy if exists discipline_actions_select on public.discipline_actions;
create policy discipline_actions_select
on public.discipline_actions
for select
to authenticated
using (
  public.has_admin_permission('manage_discipline')
  or exists (
    select 1
    from public.player_accounts pa
    where pa.auth_user_id = (select auth.uid())
      and pa.player_id = discipline_actions.player_id
  )
);

drop policy if exists rating_state_admin_write on public.rating_state;
drop policy if exists rating_state_admin_insert on public.rating_state;
drop policy if exists rating_state_admin_update on public.rating_state;
drop policy if exists rating_state_admin_delete on public.rating_state;
drop policy if exists rating_events_admin_write on public.rating_events;
drop policy if exists rating_events_admin_insert on public.rating_events;
drop policy if exists rating_events_admin_update on public.rating_events;
drop policy if exists rating_events_admin_delete on public.rating_events;

revoke insert, update, delete on public.profiles from authenticated;
grant select on public.profiles to authenticated;

revoke insert, update, delete on public.player_accounts from authenticated;
grant select on public.player_accounts to authenticated;

revoke delete on public.players from authenticated;
revoke update on public.players from authenticated;
grant select, insert on public.players to authenticated;
grant update (
  display_name,
  real_first_name,
  real_last_name,
  show_display_name,
  show_real_first_name,
  show_real_last_name,
  profile_message_md,
  profile_media_url
) on public.players to authenticated;

grant select, insert, update, delete on public.seasons to authenticated;
revoke insert, update, delete on public.casual_events from authenticated;
grant select on public.casual_events to authenticated;
revoke insert, update, delete on public.rulesets from authenticated;
grant select on public.rulesets to authenticated;

revoke delete on public.matches from authenticated;
revoke update on public.matches from authenticated;
grant select, insert on public.matches to authenticated;
grant update (
  season_id,
  casual_event_id,
  ruleset_id,
  game_number,
  table_mode,
  extra_sticks,
  include_in_lifetime_rating,
  played_at,
  table_label,
  notes
) on public.matches to authenticated;
grant select, insert, update, delete on public.match_results to authenticated;
revoke update on public.adjustments from authenticated;
grant select, insert, delete on public.adjustments to authenticated;

revoke insert, update, delete on public.discipline_actions from authenticated;
grant select on public.discipline_actions to authenticated;

revoke insert, update, delete on public.rating_state, public.rating_events from authenticated;

revoke all on function public.recompute_match_derived(uuid) from public, anon, authenticated;
revoke all on function public.recompute_season_ratings(uuid) from public, anon, authenticated;
revoke all on function public.recompute_lifetime_ratings() from public, anon, authenticated;
revoke all on function public.recompute_all_ratings() from public, anon, authenticated;
revoke all on function public.create_season(text, date, date, boolean) from public, anon, authenticated;
revoke all on function public.get_or_create_casual_event(text) from public, anon, authenticated;
revoke all on function public.set_casual_match_event(uuid, uuid) from public, anon, authenticated;
revoke all on function public.delete_match_and_recompute(uuid) from public, anon, authenticated;
revoke all on function public.finalize_match(uuid, boolean) from public, anon, authenticated;
revoke all on function public.set_player_account_link(uuid, uuid) from public, anon, authenticated;
revoke all on function public.issue_discipline_action(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.revoke_discipline_action(uuid, text) from public, anon, authenticated;

create or replace function public.recompute_all_ratings_authorized()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_admin_permission('recompute_ratings') then
    raise exception 'missing permission: recompute_ratings'
      using errcode = '42501';
  end if;

  perform public.recompute_all_ratings();
end;
$$;

revoke all on function public.recompute_all_ratings_authorized() from public, anon, authenticated;
grant execute on function public.recompute_all_ratings_authorized() to authenticated;

create or replace function public.create_season_authorized(
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
begin
  if not public.has_admin_permission('manage_seasons') then
    raise exception 'missing permission: manage_seasons'
      using errcode = '42501';
  end if;

  return public.create_season(
    p_name,
    p_start_date,
    p_end_date,
    p_is_active
  );
end;
$$;

revoke all on function public.create_season_authorized(text, date, date, boolean) from public, anon, authenticated;
grant execute on function public.create_season_authorized(text, date, date, boolean) to authenticated;

create or replace function public.get_or_create_casual_event_authorized(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_admin_permission('add_matches') then
    raise exception 'missing permission: add_matches'
      using errcode = '42501';
  end if;

  return public.get_or_create_casual_event(p_name);
end;
$$;

revoke all on function public.get_or_create_casual_event_authorized(text) from public, anon, authenticated;
grant execute on function public.get_or_create_casual_event_authorized(text) to authenticated;

create or replace function public.set_casual_match_event_authorized(
  p_match_id uuid,
  p_casual_event_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_admin_permission('add_matches') then
    raise exception 'missing permission: add_matches'
      using errcode = '42501';
  end if;

  perform public.set_casual_match_event(p_match_id, p_casual_event_id);
end;
$$;

revoke all on function public.set_casual_match_event_authorized(uuid, uuid) from public, anon, authenticated;
grant execute on function public.set_casual_match_event_authorized(uuid, uuid) to authenticated;

create or replace function public.delete_match_and_recompute_authorized(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_admin_permission('remove_matches') then
    raise exception 'missing permission: remove_matches'
      using errcode = '42501';
  end if;

  perform public.delete_match_and_recompute(p_match_id);
end;
$$;

revoke all on function public.delete_match_and_recompute_authorized(uuid) from public, anon, authenticated;
grant execute on function public.delete_match_and_recompute_authorized(uuid) to authenticated;

create or replace function public.finalize_match_authorized(
  p_match_id uuid,
  p_update_lifetime boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_created_via_import boolean;
begin
  if not public.has_admin_permission('add_matches') then
    raise exception 'missing permission: add_matches'
      using errcode = '42501';
  end if;

  select m.created_via_import
  into v_created_via_import
  from public.matches m
  where m.id = p_match_id;

  if not found then
    raise exception 'match % not found', p_match_id;
  end if;

  if v_created_via_import then
    raise exception 'imported matches must use finalize_imported_match'
      using errcode = '42501';
  end if;

  perform public.finalize_match(p_match_id, p_update_lifetime);
end;
$$;

revoke all on function public.finalize_match_authorized(uuid, boolean) from public, anon, authenticated;
grant execute on function public.finalize_match_authorized(uuid, boolean) to authenticated;

create or replace function public.finalize_imported_match(
  p_match_id uuid,
  p_update_lifetime boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_status public.match_status;
  v_created_via_import boolean;
  v_created_by uuid;
begin
  if not public.has_admin_permission('import_matches') then
    raise exception 'missing permission: import_matches'
      using errcode = '42501';
  end if;

  -- Match workers lock result rows before their parent. Preserve that order
  -- while taking the provenance lock so result entry cannot deadlock with
  -- finalization.
  perform pg_advisory_xact_lock(734221, 1);
  lock table public.match_results in share row exclusive mode;
  perform mr.seat
  from public.match_results mr
  where mr.match_id = p_match_id
  order by public.seat_priority(mr.seat)
  for update;

  select m.status, m.created_via_import, m.created_by
  into v_status, v_created_via_import, v_created_by
  from public.matches m
  where m.id = p_match_id
  for update;

  if not found then
    raise exception 'match % not found', p_match_id;
  end if;

  if v_status <> 'draft'
     or not v_created_via_import
     or v_created_by is distinct from v_actor_user_id then
    raise exception 'imported draft % is not owned by the authenticated user', p_match_id
      using errcode = '42501';
  end if;

  perform public.finalize_match(p_match_id, p_update_lifetime);
end;
$$;

revoke all on function public.finalize_imported_match(uuid, boolean) from public, anon, authenticated;
grant execute on function public.finalize_imported_match(uuid, boolean) to authenticated;

create or replace function public.discard_imported_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_status public.match_status;
  v_created_via_import boolean;
  v_created_by uuid;
begin
  if not public.has_admin_permission('import_matches') then
    raise exception 'missing permission: import_matches'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(734221, 1);
  lock table public.match_results in share row exclusive mode;
  perform mr.seat
  from public.match_results mr
  where mr.match_id = p_match_id
  order by public.seat_priority(mr.seat)
  for update;

  select m.status, m.created_via_import, m.created_by
  into v_status, v_created_via_import, v_created_by
  from public.matches m
  where m.id = p_match_id
  for update;

  if not found then
    raise exception 'match % not found', p_match_id;
  end if;

  if v_status <> 'draft'
     or not v_created_via_import
     or v_created_by is distinct from v_actor_user_id then
    raise exception 'imported draft % is not owned by the authenticated user', p_match_id
      using errcode = '42501';
  end if;

  perform public.delete_match_and_recompute(p_match_id);
end;
$$;

revoke all on function public.discard_imported_match(uuid) from public, anon, authenticated;
grant execute on function public.discard_imported_match(uuid) to authenticated;

create or replace function public.set_player_account_link_authorized(
  p_player_id uuid,
  p_auth_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_admin_permission('manage_player_accounts') then
    raise exception 'missing permission: manage_player_accounts'
      using errcode = '42501';
  end if;

  perform public.set_player_account_link(p_player_id, p_auth_user_id);
end;
$$;

revoke all on function public.set_player_account_link_authorized(uuid, uuid) from public, anon, authenticated;
grant execute on function public.set_player_account_link_authorized(uuid, uuid) to authenticated;

create or replace function public.issue_discipline_action_authorized(
  p_player_id uuid,
  p_action_type text,
  p_reason text,
  p_match_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_admin_permission('manage_discipline') then
    raise exception 'missing permission: manage_discipline'
      using errcode = '42501';
  end if;

  return public.issue_discipline_action(
    p_player_id,
    p_action_type,
    p_reason,
    p_match_id
  );
end;
$$;

revoke all on function public.issue_discipline_action_authorized(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.issue_discipline_action_authorized(uuid, text, text, uuid) to authenticated;

create or replace function public.revoke_discipline_action_authorized(
  p_action_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_admin_permission('manage_discipline') then
    raise exception 'missing permission: manage_discipline'
      using errcode = '42501';
  end if;

  return public.revoke_discipline_action(p_action_id, p_reason);
end;
$$;

revoke all on function public.revoke_discipline_action_authorized(uuid, text) from public, anon, authenticated;
grant execute on function public.revoke_discipline_action_authorized(uuid, text) to authenticated;

create or replace function public.set_player_active(
  p_player_id uuid,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_admin_permission('remove_players') then
    raise exception 'missing permission: remove_players'
      using errcode = '42501';
  end if;

  if p_player_id is null or p_is_active is null then
    raise exception 'player and active status are required';
  end if;

  perform 1
  from public.players p
  where p.id = p_player_id
  for update;

  if not found then
    raise exception 'player % not found', p_player_id;
  end if;

  perform set_config('azriichi.allow_player_active_update', 'on', true);

  update public.players p
  set is_active = p_is_active
  where p.id = p_player_id;
end;
$$;

revoke all on function public.set_player_active(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_player_active(uuid, boolean) to authenticated;

create or replace function public.get_effective_player_restrictions(
  p_on_date date,
  p_player_ids uuid[] default null
)
returns table (
  player_id uuid,
  action_type public.discipline_action_type,
  expires_on date
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_admin_permission('add_matches') then
    raise exception 'missing permission: add_matches'
      using errcode = '42501';
  end if;

  if p_on_date is null then
    raise exception 'restriction date is required';
  end if;

  if p_player_ids is not null and cardinality(p_player_ids) > 5000 then
    raise exception 'too many player ids requested';
  end if;

  return query
  select
    da.player_id,
    da.action_type,
    da.expires_on
  from public.discipline_actions da
  where da.revoked_at is null
    and da.action_type in ('suspension', 'ban')
    and da.effective_on <= p_on_date
    and (
      da.action_type = 'ban'
      or da.expires_on >= p_on_date
    )
    and (
      p_player_ids is null
      or da.player_id = any (p_player_ids)
    )
  order by
    da.player_id,
    case da.action_type when 'ban' then 0 else 1 end,
    da.expires_on desc nulls first,
    da.issued_at desc,
    da.id desc;
end;
$$;

revoke all on function public.get_effective_player_restrictions(date, uuid[]) from public, anon, authenticated;
grant execute on function public.get_effective_player_restrictions(date, uuid[]) to authenticated;

-- Final privilege cleanup: internal SECURITY DEFINER helpers must not be RPCs.
revoke execute on function public.assert_player_competitive_eligible(uuid, uuid)
from public, anon, authenticated;

revoke execute on function public.guard_match_discipline()
from public, anon, authenticated;

revoke execute on function public.guard_match_result_discipline()
from public, anon, authenticated;

revoke execute on function public.handle_new_user()
from public, anon, authenticated;

revoke execute on function public.update_my_player_profile(
  text,
  text,
  text,
  boolean,
  boolean,
  boolean,
  text,
  text
) from public, anon;

drop function if exists public.update_my_player_display(
  text,
  text,
  text,
  boolean,
  boolean,
  boolean
);
