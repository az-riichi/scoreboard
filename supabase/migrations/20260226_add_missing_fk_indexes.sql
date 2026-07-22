-- Add covering indexes for frequently joined/validated foreign keys flagged by Supabase advisor.

create index if not exists adjustments_created_by_idx
  on public.adjustments (created_by);

create index if not exists adjustments_player_id_idx
  on public.adjustments (player_id);

create index if not exists matches_created_by_idx
  on public.matches (created_by);

create index if not exists matches_ruleset_id_idx
  on public.matches (ruleset_id);
