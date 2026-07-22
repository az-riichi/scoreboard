-- Split UMA across ties by raw score.
-- Example: tie for 1st => each gets average(uma_1, uma_2).

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
