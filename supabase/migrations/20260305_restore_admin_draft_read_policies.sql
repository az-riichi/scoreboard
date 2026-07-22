-- Admin pages need to read draft matches/results.
-- Also required for insert(...).select(...) on draft rows.

drop policy if exists matches_admin_select on public.matches;
create policy matches_admin_select
on public.matches
for select
to authenticated
using (public.admin_only());

drop policy if exists match_results_admin_select on public.match_results;
create policy match_results_admin_select
on public.match_results
for select
to authenticated
using (public.admin_only());
