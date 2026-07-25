-- Categorize matches in the timeless Casual season into named events.
-- Event-scoped analytics intentionally live beside the existing season-wide
-- views so "All events" continues to include every Casual result.

create table if not exists public.casual_events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint casual_events_name_check check (
    name = btrim(name)
    and char_length(name) between 1 and 100
  )
);

create unique index if not exists casual_events_name_lower_unique
on public.casual_events (lower(name));

create index if not exists casual_events_created_by_idx
on public.casual_events (created_by);

alter table public.matches
  add column if not exists casual_event_id uuid
  references public.casual_events(id) on delete restrict;

create index if not exists matches_casual_event_played_idx
on public.matches (casual_event_id, played_at desc)
where casual_event_id is not null;

-- Match-linked adjustments let event standings attribute CHOMBO penalties to
-- the same event as the match without duplicating mutable event metadata.
alter table public.adjustments
  add column if not exists match_id uuid;

update public.adjustments a
set match_id = m.id
from public.matches m
where a.match_id is null
  and a.season_id = m.season_id
  and a.reason ~ '^CHOMBO:[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}:'
  and split_part(a.reason, ':', 2) = m.id::text;

-- The composite FK prevents an adjustment from pointing at a match in a
-- different season. The redundant unique index is required as its target.
create unique index if not exists matches_season_id_id_unique
on public.matches (season_id, id);

create index if not exists adjustments_match_id_idx
on public.adjustments (match_id)
where match_id is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.adjustments'::regclass
      and conname = 'adjustments_season_match_fk'
  ) then
    alter table public.adjustments
      add constraint adjustments_season_match_fk
      foreign key (season_id, match_id)
      references public.matches (season_id, id)
      on delete cascade
      not valid;
  end if;
end $$;

alter table public.adjustments
  validate constraint adjustments_season_match_fk;

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

-- Categorization does not affect scoring or ratings, so admins may use this
-- guarded path to classify pre-existing finalized Casual matches.
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

drop trigger if exists matches_validate_metadata on public.matches;
create trigger matches_validate_metadata
before insert or update of season_id, played_at, game_number, table_mode, status,
  include_in_lifetime_rating, casual_event_id
on public.matches
for each row execute function public.validate_match_metadata();

-- A finalized match's event is historical metadata, just like its season/date.
-- The narrow repair switch is used only by guarded administrative RPCs.
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

drop trigger if exists matches_guard_final_metadata on public.matches;
create trigger matches_guard_final_metadata
before update of season_id, ruleset_id, played_at, game_number, table_mode,
  extra_sticks, include_in_lifetime_rating, casual_event_id
on public.matches
for each row execute function public.guard_final_match_metadata();

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

alter table public.casual_events enable row level security;

drop policy if exists casual_events_public_read on public.casual_events;
create policy casual_events_public_read
on public.casual_events
for select
to anon, authenticated
using (true);

drop policy if exists casual_events_admin_insert on public.casual_events;
create policy casual_events_admin_insert
on public.casual_events
for insert
to authenticated
with check (public.admin_only());

drop policy if exists casual_events_admin_update on public.casual_events;
create policy casual_events_admin_update
on public.casual_events
for update
to authenticated
using (public.admin_only())
with check (public.admin_only());

drop policy if exists casual_events_admin_delete on public.casual_events;
create policy casual_events_admin_delete
on public.casual_events
for delete
to authenticated
using (public.admin_only());

grant select on public.casual_events to anon, authenticated;
grant insert, update, delete on public.casual_events to authenticated;

-- Older deployments have played_at as column 4; later ones inserted match
-- metadata at columns 4-6. CREATE OR REPLACE VIEW requires existing columns
-- to retain their positions, so preserve either layout and append event data.
do $$
declare
  fourth_column text;
begin
  select c.column_name
  into fourth_column
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'v_final_results'
    and c.ordinal_position = 4;

  if fourth_column is null or fourth_column = 'game_number' then
    execute $view$
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
        r.tobi,
        m.casual_event_id,
        ce.name as casual_event_name
      from public.matches m
      join public.match_results r on r.match_id = m.id
      join public.v_public_players p on p.id = r.player_id
      left join public.casual_events ce on ce.id = m.casual_event_id
      where m.status = 'final'
    $view$;
  elsif fourth_column = 'played_at' then
    execute $view$
      create or replace view public.v_final_results
      with (security_invoker = true)
      as
      select
        m.id as match_id,
        m.season_id,
        m.ruleset_id,
        m.played_at,
        m.table_label,
        r.seat,
        r.player_id,
        p.public_name as display_name,
        r.raw_points,
        r.club_points,
        r.placement,
        r.tobi,
        m.game_number,
        m.table_mode,
        m.extra_sticks,
        m.casual_event_id,
        ce.name as casual_event_name
      from public.matches m
      join public.match_results r on r.match_id = m.id
      join public.v_public_players p on p.id = r.player_id
      left join public.casual_events ce on ce.id = m.casual_event_id
      where m.status = 'final'
    $view$;
  else
    raise exception 'unsupported v_final_results layout: column 4 is %', fourth_column;
  end if;
end $$;

-- Match-linked adjustments should affect published standings only after their
-- match is final. Season-wide adjustments remain effective immediately.
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
  select a.season_id, a.player_id, sum(a.points) as adj_points
  from public.adjustments a
  left join public.matches m
    on m.id = a.match_id
   and m.season_id = a.season_id
  where a.match_id is null
     or m.status = 'final'
  group by a.season_id, a.player_id
)
select
  b.*,
  coalesce(a.adj_points, 0) as adjustment_points,
  (b.total_points + coalesce(a.adj_points, 0)) as total_points_with_adjustments,
  dense_rank() over (
    partition by b.season_id
    order by (b.total_points + coalesce(a.adj_points, 0)) desc
  ) as rank
from base b
left join adj a
  on a.season_id = b.season_id
 and a.player_id = b.player_id;

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
  tobi,
  casual_event_id,
  casual_event_name
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
  placement,
  casual_event_id,
  casual_event_name
from public.v_final_results;

create or replace view public.v_casual_event_standings
with (security_invoker = true)
as
with base as (
  select
    season_id,
    casual_event_id,
    casual_event_name,
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
  where casual_event_id is not null
  group by season_id, casual_event_id, casual_event_name, player_id, display_name
),
adj as (
  select
    a.season_id,
    m.casual_event_id,
    a.player_id,
    sum(a.points) as adj_points
  from public.adjustments a
  join public.matches m
    on m.id = a.match_id
   and m.season_id = a.season_id
  where m.status = 'final'
    and m.casual_event_id is not null
  group by a.season_id, m.casual_event_id, a.player_id
)
select
  b.*,
  coalesce(a.adj_points, 0) as adjustment_points,
  (b.total_points + coalesce(a.adj_points, 0)) as total_points_with_adjustments,
  dense_rank() over (
    partition by b.season_id, b.casual_event_id
    order by (b.total_points + coalesce(a.adj_points, 0)) desc
  ) as rank
from base b
left join adj a
  on a.season_id = b.season_id
 and a.casual_event_id = b.casual_event_id
 and a.player_id = b.player_id;

create or replace view public.v_casual_event_player_stats
with (security_invoker = true)
as
with g as (
  select
    season_id,
    casual_event_id,
    casual_event_name,
    player_id,
    display_name,
    match_id,
    played_at,
    placement,
    club_points
  from public.v_final_results
  where casual_event_id is not null
),
agg as (
  select
    season_id,
    casual_event_id,
    casual_event_name,
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
  group by season_id, casual_event_id, casual_event_name, player_id, display_name
),
best as (
  select distinct on (season_id, casual_event_id, player_id)
    season_id,
    casual_event_id,
    player_id,
    match_id as best_match_id,
    played_at as best_played_at
  from g
  order by season_id, casual_event_id, player_id, club_points desc, played_at desc, match_id desc
),
worst as (
  select distinct on (season_id, casual_event_id, player_id)
    season_id,
    casual_event_id,
    player_id,
    match_id as worst_match_id,
    played_at as worst_played_at
  from g
  order by season_id, casual_event_id, player_id, club_points asc, played_at desc, match_id desc
)
select
  a.*,
  b.best_match_id,
  b.best_played_at,
  w.worst_match_id,
  w.worst_played_at
from agg a
left join best b
  on b.season_id = a.season_id
 and b.casual_event_id = a.casual_event_id
 and b.player_id = a.player_id
left join worst w
  on w.season_id = a.season_id
 and w.casual_event_id = a.casual_event_id
 and w.player_id = a.player_id;

create or replace view public.v_casual_event_player_point_history
with (security_invoker = true)
as
with per_match as (
  select
    fr.season_id,
    fr.casual_event_id,
    fr.casual_event_name,
    fr.player_id,
    fr.display_name,
    fr.played_at,
    fr.match_id,
    fr.club_points,
    coalesce(a.adjustment_points, 0::numeric) as adjustment_points
  from public.v_final_results fr
  left join (
    select
      match_id,
      player_id,
      sum(points) as adjustment_points
    from public.adjustments
    where match_id is not null
    group by match_id, player_id
  ) a
    on a.match_id = fr.match_id
   and a.player_id = fr.player_id
  where fr.casual_event_id is not null
)
select
  season_id,
  casual_event_id,
  casual_event_name,
  player_id,
  display_name,
  played_at,
  match_id,
  club_points,
  adjustment_points,
  (club_points + adjustment_points) as points_with_adjustments,
  sum(club_points + adjustment_points) over (
    partition by season_id, casual_event_id, player_id
    order by played_at asc, match_id asc
    rows between unbounded preceding and current row
  ) as cumulative_points
from per_match;

grant select on public.v_final_results to anon, authenticated;
grant select on public.v_player_match_history to anon, authenticated;
grant select on public.v_player_placement_history to anon, authenticated;
grant select on public.v_casual_event_standings to anon, authenticated;
grant select on public.v_casual_event_player_stats to anon, authenticated;
grant select on public.v_casual_event_player_point_history to anon, authenticated;
