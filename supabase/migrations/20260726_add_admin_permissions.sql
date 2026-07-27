-- Add role-based and granular administrator access.
--
-- Existing administrators become super administrators. No owner is selected
-- automatically: bootstrap the intended owner explicitly from the SQL editor
-- after this migration has been applied.

-- ---------------------------------------------------------------------------
-- Permission model and compatibility mirror
-- ---------------------------------------------------------------------------

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

-- Preserve all legacy administrators. An existing granular role is never
-- overwritten if this idempotent section is replayed.
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

-- ---------------------------------------------------------------------------
-- Audited access changes
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Immutable provenance and removal-state guards
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Granular RLS
-- ---------------------------------------------------------------------------

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

-- Table grants remain broad enough for PostgREST to issue the relevant SQL
-- verb, while RLS performs the per-permission authorization.
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

-- ---------------------------------------------------------------------------
-- Authorized RPC façade over the existing SECURITY DEFINER workers
-- ---------------------------------------------------------------------------

-- The existing workers remain callable by their owner so nested rating
-- rebuilds continue to work, but are no longer application RPC endpoints.
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

-- Match entry needs only the effective suspension/ban, not private reasons,
-- issuers, strike history, or revocation history.
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
