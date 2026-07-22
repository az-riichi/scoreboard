-- Supabase security advisor: avoid role-mutable search_path on helper functions.
-- Set an explicit function-local search_path.

alter function public.seat_priority(public.seat)
  set search_path = public;

alter function public.place_base_points(smallint)
  set search_path = public;

alter function public.games_adjustment(int)
  set search_path = public;

alter function public.uma_for_place(public.rulesets, smallint)
  set search_path = public;

alter function public.oka_for_place(public.rulesets, smallint)
  set search_path = public;

alter function public.player_public_name(public.players)
  set search_path = public;

