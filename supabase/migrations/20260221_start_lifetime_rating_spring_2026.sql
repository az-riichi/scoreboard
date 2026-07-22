-- Start lifetime Rating (R) from Spring 2026.
-- Matches in earlier seasons (e.g. 2025 pre-season) do not affect lifetime R.

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

  select s.start_date
  into match_season_start
  from public.seasons s
  where s.id = m.season_id;

  select coalesce(
    (
      select s.start_date
      from public.seasons s
      where lower(trim(s.name)) like 'spring 2026%'
      order by s.start_date asc
      limit 1
    ),
    date '2026-01-01'
  )
  into lifetime_start;

  perform public.recompute_match_derived(p_match_id);

  -- Season rating: carry previous season terminal state forward.
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

  -- Lifetime rating starts at Spring 2026; earlier seasons are ignored.
  if p_update_lifetime and match_season_start is not null and match_season_start >= lifetime_start then
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
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only';
  end if;

  select coalesce(
    (
      select s.start_date
      from public.seasons s
      where lower(trim(s.name)) like 'spring 2026%'
      order by s.start_date asc
      limit 1
    ),
    date '2026-01-01'
  )
  into lifetime_start;

  delete from public.rating_events where is_lifetime = true;
  delete from public.rating_state  where is_lifetime = true;

  for mid in
    select m.id
    from public.matches m
    join public.seasons s on s.id = m.season_id
    where m.status = 'final'
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
grant execute on function public.recompute_lifetime_ratings() to authenticated;
