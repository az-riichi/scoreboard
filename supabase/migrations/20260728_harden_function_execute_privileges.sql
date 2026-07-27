-- SECURITY DEFINER functions default to EXECUTE for PUBLIC. Keep RPC access
-- explicit, and make trigger/internal helpers unreachable through PostgREST.

revoke execute on function public.assert_player_competitive_eligible(uuid, uuid)
from public, anon, authenticated;

revoke execute on function public.guard_match_discipline()
from public, anon, authenticated;

revoke execute on function public.guard_match_result_discipline()
from public, anon, authenticated;

revoke execute on function public.handle_new_user()
from public, anon, authenticated;

revoke execute on function public.update_my_player_profile(
  text,
  text,
  text,
  boolean,
  boolean,
  boolean,
  text,
  text
) from public, anon;

-- Superseded by update_my_player_profile, which preserves the same identity
-- fields and also owns the profile content fields used by the application.
drop function if exists public.update_my_player_display(
  text,
  text,
  text,
  boolean,
  boolean,
  boolean
);
