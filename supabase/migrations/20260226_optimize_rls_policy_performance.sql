-- Supabase advisor follow-up:
-- 1) Wrap auth.uid() in SELECT inside RLS expressions to avoid per-row re-evaluation.
-- 2) Split admin "FOR ALL" policies into write-only policies so SELECT does not stack with read policies.

-- profiles: cache auth.uid() via SELECT in policy expressions
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

-- player_accounts: cache auth.uid() via SELECT in self/admin read policy
drop policy if exists player_accounts_select on public.player_accounts;
create policy player_accounts_select
on public.player_accounts
for select
to authenticated
using ((select auth.uid()) = auth_user_id or public.is_admin((select auth.uid())));

-- admin helper: cache auth.uid() via SELECT
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

-- Replace FOR ALL admin policies with write-only policies so SELECT only uses *_read.

-- player_accounts
drop policy if exists player_accounts_admin_write on public.player_accounts;
drop policy if exists player_accounts_admin_insert on public.player_accounts;
drop policy if exists player_accounts_admin_update on public.player_accounts;
drop policy if exists player_accounts_admin_delete on public.player_accounts;
create policy player_accounts_admin_insert on public.player_accounts
for insert to authenticated
with check (public.admin_only());
create policy player_accounts_admin_update on public.player_accounts
for update to authenticated
using (public.admin_only()) with check (public.admin_only());
create policy player_accounts_admin_delete on public.player_accounts
for delete to authenticated
using (public.admin_only());

-- seasons
drop policy if exists seasons_admin_write on public.seasons;
drop policy if exists seasons_admin_insert on public.seasons;
drop policy if exists seasons_admin_update on public.seasons;
drop policy if exists seasons_admin_delete on public.seasons;
create policy seasons_admin_insert on public.seasons
for insert to authenticated
with check (public.admin_only());
create policy seasons_admin_update on public.seasons
for update to authenticated
using (public.admin_only()) with check (public.admin_only());
create policy seasons_admin_delete on public.seasons
for delete to authenticated
using (public.admin_only());

-- players
drop policy if exists players_admin_write on public.players;
drop policy if exists players_admin_insert on public.players;
drop policy if exists players_admin_update on public.players;
drop policy if exists players_admin_delete on public.players;
create policy players_admin_insert on public.players
for insert to authenticated
with check (public.admin_only());
create policy players_admin_update on public.players
for update to authenticated
using (public.admin_only()) with check (public.admin_only());
create policy players_admin_delete on public.players
for delete to authenticated
using (public.admin_only());

-- rulesets
drop policy if exists rulesets_admin_write on public.rulesets;
drop policy if exists rulesets_admin_insert on public.rulesets;
drop policy if exists rulesets_admin_update on public.rulesets;
drop policy if exists rulesets_admin_delete on public.rulesets;
create policy rulesets_admin_insert on public.rulesets
for insert to authenticated
with check (public.admin_only());
create policy rulesets_admin_update on public.rulesets
for update to authenticated
using (public.admin_only()) with check (public.admin_only());
create policy rulesets_admin_delete on public.rulesets
for delete to authenticated
using (public.admin_only());

-- matches
drop policy if exists matches_admin_write on public.matches;
drop policy if exists matches_admin_insert on public.matches;
drop policy if exists matches_admin_update on public.matches;
drop policy if exists matches_admin_delete on public.matches;
create policy matches_admin_insert on public.matches
for insert to authenticated
with check (public.admin_only());
create policy matches_admin_update on public.matches
for update to authenticated
using (public.admin_only()) with check (public.admin_only());
create policy matches_admin_delete on public.matches
for delete to authenticated
using (public.admin_only());

-- match_results
drop policy if exists match_results_admin_write on public.match_results;
drop policy if exists match_results_admin_insert on public.match_results;
drop policy if exists match_results_admin_update on public.match_results;
drop policy if exists match_results_admin_delete on public.match_results;
create policy match_results_admin_insert on public.match_results
for insert to authenticated
with check (public.admin_only());
create policy match_results_admin_update on public.match_results
for update to authenticated
using (public.admin_only()) with check (public.admin_only());
create policy match_results_admin_delete on public.match_results
for delete to authenticated
using (public.admin_only());

-- adjustments
drop policy if exists adjustments_admin_write on public.adjustments;
drop policy if exists adjustments_admin_insert on public.adjustments;
drop policy if exists adjustments_admin_update on public.adjustments;
drop policy if exists adjustments_admin_delete on public.adjustments;
create policy adjustments_admin_insert on public.adjustments
for insert to authenticated
with check (public.admin_only());
create policy adjustments_admin_update on public.adjustments
for update to authenticated
using (public.admin_only()) with check (public.admin_only());
create policy adjustments_admin_delete on public.adjustments
for delete to authenticated
using (public.admin_only());

-- rating_state
drop policy if exists rating_state_admin_write on public.rating_state;
drop policy if exists rating_state_admin_insert on public.rating_state;
drop policy if exists rating_state_admin_update on public.rating_state;
drop policy if exists rating_state_admin_delete on public.rating_state;
create policy rating_state_admin_insert on public.rating_state
for insert to authenticated
with check (public.admin_only());
create policy rating_state_admin_update on public.rating_state
for update to authenticated
using (public.admin_only()) with check (public.admin_only());
create policy rating_state_admin_delete on public.rating_state
for delete to authenticated
using (public.admin_only());

-- rating_events
drop policy if exists rating_events_admin_write on public.rating_events;
drop policy if exists rating_events_admin_insert on public.rating_events;
drop policy if exists rating_events_admin_update on public.rating_events;
drop policy if exists rating_events_admin_delete on public.rating_events;
create policy rating_events_admin_insert on public.rating_events
for insert to authenticated
with check (public.admin_only());
create policy rating_events_admin_update on public.rating_events
for update to authenticated
using (public.admin_only()) with check (public.admin_only());
create policy rating_events_admin_delete on public.rating_events
for delete to authenticated
using (public.admin_only());
