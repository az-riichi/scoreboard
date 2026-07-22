-- Correct scoring/rating state and harden authorization, player privacy, and
-- match integrity. All data repairs are idempotent and retain legacy rows that
-- cannot be validated automatically.

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

-- ---------------------------------------------------------------------------
-- Core constraints and match identity
-- ---------------------------------------------------------------------------

alter table public.rulesets alter column return_points set default 25000;
alter table public.matches
  add column if not exists include_in_lifetime_rating boolean not null default true;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'matches_game_number_check'
      and conrelid = 'public.matches'::regclass
  ) then
    alter table public.matches
      add constraint matches_game_number_check
      check (game_number is null or game_number > 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'matches_extra_sticks_check'
      and conrelid = 'public.matches'::regclass
  ) then
    alter table public.matches
      add constraint matches_extra_sticks_check
      check (extra_sticks >= 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'seasons_date_order_check'
      and conrelid = 'public.seasons'::regclass
  ) then
    alter table public.seasons
      add constraint seasons_date_order_check
      check (start_date <= end_date) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'rulesets_positive_values_check'
      and conrelid = 'public.rulesets'::regclass
  ) then
    alter table public.rulesets
      add constraint rulesets_positive_values_check
      check (start_points > 0 and return_points > 0 and point_divisor > 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'matches_game_metadata_pair_check'
      and conrelid = 'public.matches'::regclass
  ) then
    alter table public.matches
      add constraint matches_game_metadata_pair_check
      check ((game_number is null) = (table_mode is null)) not valid;
  end if;
end $$;

-- Keep the newest active season if a legacy deployment has more than one.
with ranked_active as (
  select
    id,
    row_number() over (order by start_date desc, created_at desc, id desc) as rn
  from public.seasons
  where is_active
)
update public.seasons s
set is_active = false
from ranked_active r
where s.id = r.id and r.rn > 1;

create unique index if not exists seasons_one_active_idx
on public.seasons (is_active)
where is_active;

-- Do not fail deployment on legacy duplicate keys. The trigger below still
-- prevents any new duplicate; after cleanup, re-running creates the index.
do $$
begin
  if to_regclass('public.matches_season_day_game_table_unique') is null then
    if exists (
      select 1
      from public.matches m
      where m.status <> 'void'
        and m.game_number is not null
        and m.table_mode is not null
      group by
        m.season_id,
        (m.played_at at time zone 'America/Phoenix')::date,
        m.game_number,
        m.table_mode
      having count(*) > 1
    ) then
      raise warning 'matches business-key unique index skipped: legacy duplicates must be resolved';
    else
      create unique index matches_season_day_game_table_unique
      on public.matches (
        season_id,
        ((played_at at time zone 'America/Phoenix')::date),
        game_number,
        table_mode
      )
      where status <> 'void' and game_number is not null and table_mode is not null;
    end if;
  end if;
end $$;

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

drop trigger if exists matches_validate_metadata on public.matches;
create trigger matches_validate_metadata
before insert or update of season_id, played_at, game_number, table_mode, status
on public.matches
for each row execute function public.validate_match_metadata();

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

drop trigger if exists seasons_guard_identity_update on public.seasons;
create trigger seasons_guard_identity_update
before update of name, start_date, end_date on public.seasons
for each row execute function public.guard_season_identity_update();

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

  new.placement := null;
  new.club_points := null;
  new.tobi := false;
  return new;
end;
$$;

revoke all on function public.guard_match_result_write() from public;

drop trigger if exists match_results_guard_write on public.match_results;
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

drop trigger if exists match_results_guard_derived_write on public.match_results;
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

drop trigger if exists matches_guard_final_metadata on public.matches;
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

drop trigger if exists matches_guard_status_transition on public.matches;
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

drop trigger if exists matches_guard_published_delete on public.matches;
create trigger matches_guard_published_delete
before delete on public.matches
for each row execute function public.guard_published_match_delete();

-- ---------------------------------------------------------------------------
-- Rating/scoring helpers
-- ---------------------------------------------------------------------------

create or replace function public.games_adjustment(n int)
returns numeric
language sql
immutable
set search_path = public
as $$
  select case
    when n is null then 1
    when n <= 20 then greatest(1 - (0.04::numeric * n::numeric), 0.2)
    else 0.2
  end;
$$;

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

do $$
begin
  perform set_config('azriichi.allow_final_metadata_repair', 'on', true);
  update public.matches m
  set include_in_lifetime_rating = false
  from public.seasons s
  where s.id = m.season_id
    and m.status = 'final'
    and m.include_in_lifetime_rating is distinct from false
    and s.start_date >= public.lifetime_rating_start_date()
    and exists (
      select 1 from public.rating_events re
      where re.match_id = m.id and re.is_lifetime = false
    )
    and not exists (
      select 1 from public.rating_events re
      where re.match_id = m.id and re.is_lifetime = true
    );
  perform set_config('azriichi.allow_final_metadata_repair', 'off', true);
end $$;

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
  delete from public.rating_state where is_lifetime = false and season_id = p_season_id;

  for mid in
    select id
    from public.matches
    where season_id = p_season_id and status = 'final'
    order by played_at asc, id asc
  loop
    select * into m from public.matches where id = mid;
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
    where rs.is_lifetime = false
      and rs.season_id = p_season_id
      and mr.match_id = mid;

    for rec in
      select mr.player_id, mr.placement, rs.rate as old_rate, rs.games_played as n
      from public.match_results mr
      join public.rating_state rs
        on rs.is_lifetime = false
       and rs.season_id = p_season_id
       and rs.player_id = mr.player_id
      where mr.match_id = mid
    loop
      declare d numeric;
      declare new_r numeric;
      begin
        d := public.games_adjustment(rec.n)
             * (public.place_base_points(rec.placement)
                + ((avg_rate - rec.old_rate) / 40.0));
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
        where is_lifetime = false
          and season_id = p_season_id
          and player_id = rec.player_id;
      end;
    end loop;
  end loop;
end;
$$;

revoke all on function public.recompute_season_ratings(uuid) from public;
revoke execute on function public.recompute_season_ratings(uuid) from anon, authenticated;

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
  delete from public.rating_state where is_lifetime = true;

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
             * (public.place_base_points(rec.placement)
                + ((avg_rate - rec.old_rate) / 40.0));
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
  ) into has_later_final;

  if has_later_final then
    perform set_config('azriichi.allow_match_finalize', 'on', true);
    update public.matches
    set status = 'final', include_in_lifetime_rating = coalesce(p_update_lifetime, false)
    where id = p_match_id;
    perform public.recompute_all_ratings();
    return;
  end if;

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
  where rs.is_lifetime = false
    and rs.season_id = m.season_id
    and mr.match_id = p_match_id;

  for rec in
    select mr.player_id, mr.placement, rs.rate as old_rate, rs.games_played as n
    from public.match_results mr
    join public.rating_state rs
      on rs.is_lifetime = false
     and rs.season_id = m.season_id
     and rs.player_id = mr.player_id
    where mr.match_id = p_match_id
  loop
    declare d numeric;
    declare new_r numeric;
    begin
      d := public.games_adjustment(rec.n)
           * (public.place_base_points(rec.placement)
              + ((avg_rate - rec.old_rate) / 40.0));
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
      where is_lifetime = false
        and season_id = m.season_id
        and player_id = rec.player_id;
    end;
  end loop;

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
              * (public.place_base_points(rec.placement)
                 + ((avg_rate - rec.old_rate) / 40.0));
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

-- ---------------------------------------------------------------------------
-- Atomic admin workflows
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Profiles and player privacy
-- ---------------------------------------------------------------------------

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

  return '(unnamed player)';
end;
$$;

revoke all on function public.player_public_name(public.players) from public;
grant execute on function public.player_public_name(public.players) to anon, authenticated;

drop policy if exists profiles_update_self on public.profiles;
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update
on public.profiles
for update
to authenticated
using (public.admin_only())
with check (public.admin_only());

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

drop policy if exists players_public_read on public.players;
drop policy if exists players_private_read on public.players;
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

revoke select on public.players from public, anon;
grant select on public.players to authenticated;
grant select on public.v_public_players to anon, authenticated;
grant select on public.player_accounts to authenticated;

revoke insert, delete on public.profiles from authenticated;
grant select, update on public.profiles to authenticated;

-- Public analytics depend only on the redacted projection, so anonymous users
-- no longer need any privilege on the private base row. Older deployments have
-- played_at as column 4; later ones inserted the match metadata at columns 4-6.
-- CREATE OR REPLACE VIEW requires every existing column to retain its position,
-- so preserve either deployed layout and only append missing metadata.
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
        r.tobi
      from public.matches m
      join public.match_results r on r.match_id = m.id
      join public.v_public_players p on p.id = r.player_id
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
        m.extra_sticks
      from public.matches m
      join public.match_results r on r.match_id = m.id
      join public.v_public_players p on p.id = r.player_id
      where m.status = 'final'
    $view$;
  else
    raise exception 'unsupported v_final_results layout: column 4 is %', fourth_column;
  end if;
end $$;

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
grant select on public.v_current_ratings to anon, authenticated;
grant select on public.v_rating_history to anon, authenticated;

-- Repair only the untouched legacy 25/20 seed. A customized ruleset with the
-- same name but other values is deliberately preserved.
insert into public.rulesets (
  name, start_points, return_points, point_divisor,
  uma_1, uma_2, uma_3, uma_4,
  oka_1, oka_2, oka_3, oka_4
)
values (
  'Default 25/25, Uma 30/10/-10/-30', 25000, 25000, 1000,
  30, 10, -10, -30,
  0, 0, 0, 0
)
on conflict (name) do update
set return_points = excluded.return_points
where public.rulesets.start_points = 25000
  and public.rulesets.return_points = 20000
  and public.rulesets.point_divisor = 1000
  and public.rulesets.uma_1 = 30
  and public.rulesets.uma_2 = 10
  and public.rulesets.uma_3 = -10
  and public.rulesets.uma_4 = -30
  and public.rulesets.oka_1 = 0
  and public.rulesets.oka_2 = 0
  and public.rulesets.oka_3 = 0
  and public.rulesets.oka_4 = 0;

-- Rebuild persisted derived points and every R event/state with the corrected
-- 0.04 multiplier. Any malformed final match aborts and rolls back the entire
-- migration, preventing old- and new-formula ratings from being mixed.
select public.recompute_all_ratings();
