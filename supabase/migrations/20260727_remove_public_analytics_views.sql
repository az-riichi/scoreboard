-- Public analytics now run against the versioned raw snapshot in the browser.
-- Drop dependants before v_final_results so this migration does not need
-- CASCADE and cannot remove unrelated objects.

drop view if exists public.v_season_standings;
drop view if exists public.v_season_player_stats;
drop view if exists public.v_player_match_history;
drop view if exists public.v_player_point_history;
drop view if exists public.v_player_placement_history;
drop view if exists public.v_casual_event_standings;
drop view if exists public.v_casual_event_player_stats;
drop view if exists public.v_casual_event_player_point_history;
drop view if exists public.v_current_ratings;
drop view if exists public.v_rating_history;
drop view if exists public.v_final_results;
