-- Add private, auditable strike/suspension/ban records with automatic
-- escalation and competitive-match eligibility enforcement.

create type public.discipline_action_type as enum ('strike', 'suspension', 'ban');
create type public.discipline_action_source as enum ('manual', 'automatic');

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

alter table public.discipline_actions enable row level security;

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

revoke all on public.discipline_actions from public, anon, authenticated;
grant select on public.discipline_actions to authenticated;

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
