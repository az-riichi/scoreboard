-- Add the singleton timeless Casual pseudo-season. Casual matches retain their
-- normal score/placement derivations, but never mutate either rating scope.

alter table public.seasons
  add column if not exists is_casual boolean not null default false;

-- The old identity trigger references only the dated shape. Remove it while a
-- pre-existing season named Casual is safely converted in place.
drop trigger if exists seasons_guard_identity_update on public.seasons;

alter table public.seasons
  drop constraint if exists seasons_date_order_check;
alter table public.seasons
  drop constraint if exists seasons_kind_dates_check;
alter table public.seasons alter column start_date drop not null;
alter table public.seasons alter column end_date drop not null;

-- Reuse an existing canonical row if one was created manually. This preserves
-- its id and all attached matches instead of manufacturing a second category.
insert into public.seasons (name, start_date, end_date, is_casual, is_active)
values ('Casual', null, null, true, false)
on conflict (name) do update
set start_date = null,
    end_date = null,
    is_casual = true,
    is_active = false;

alter table public.seasons
  add constraint seasons_kind_dates_check check (
    (is_casual and start_date is null and end_date is null and not is_active)
    or
    ((not is_casual) and start_date is not null and end_date is not null and start_date <= end_date)
  ) not valid;

-- Preserve the hardening migration's tolerance for invalid legacy rows while
-- validating the new invariant whenever the deployed data permits it.
do $$
begin
  if exists (
    select 1
    from public.seasons s
    where not (
      (s.is_casual and s.start_date is null and s.end_date is null and not s.is_active)
      or
      ((not s.is_casual) and s.start_date is not null and s.end_date is not null and s.start_date <= s.end_date)
    )
  ) then
    raise warning 'seasons_kind_dates_check remains NOT VALID: legacy season rows need repair';
  else
    execute 'alter table public.seasons validate constraint seasons_kind_dates_check';
  end if;
end $$;

create unique index if not exists seasons_one_casual_idx
on public.seasons (is_casual)
where is_casual;

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
before insert or update of season_id, played_at, game_number, table_mode, status, include_in_lifetime_rating
on public.matches
for each row execute function public.validate_match_metadata();

-- Repair the persisted replay flag before the rating rebuild. The final-match
-- metadata guard intentionally blocks this column, so use its narrow internal
-- repair switch for the duration of this transaction only.
do $$
begin
  perform set_config('azriichi.allow_final_metadata_repair', 'on', true);
  update public.matches m
  set include_in_lifetime_rating = false
  from public.seasons s
  where s.id = m.season_id
    and s.is_casual
    and m.include_in_lifetime_rating is distinct from false;
  perform set_config('azriichi.allow_final_metadata_repair', 'off', true);
end $$;

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
  delete from public.rating_state where is_lifetime = false and season_id = p_season_id;

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

-- This RPC remains the backward-compatible regular-season creator. Casual is
-- system-managed by the singleton seed above.
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

-- Existing deployments may predate this projection even though clean installs
-- already define it in the canonical snapshot.
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

grant select on public.v_player_placement_history to anon, authenticated;

-- Converting an existing dated Casual season can leave both direct Casual
-- events and downstream carried R state. Rebuild every scope once when any
-- such published data/state exists; a brand-new empty Casual row is a no-op.
do $$
declare
  v_needs_rebuild boolean;
begin
  select
    exists (
      select 1
      from public.matches m
      join public.seasons s on s.id = m.season_id
      where s.is_casual and m.status = 'final'
    )
    or exists (
      select 1
      from public.rating_state rs
      join public.seasons s on s.id = rs.season_id
      where not rs.is_lifetime and s.is_casual
    )
    or exists (
      select 1
      from public.rating_events re
      join public.matches m on m.id = re.match_id
      join public.seasons s on s.id = m.season_id
      where s.is_casual
    )
  into v_needs_rebuild;

  if v_needs_rebuild then
    perform public.recompute_all_ratings();
  end if;
end $$;
