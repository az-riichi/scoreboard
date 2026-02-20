# AZRM Scoreboard

Frontend implementation for the database schema (seasons/players/matches/results/standings/ratings).
Schema v1.2

## Features
Public (no login required):
- Seasons list
- Season standings (cumulative points + basic stats)
- Player page: season stats + match history + cumulative point history + rating history
- Match page: final results (E/S/W/N seats)

Admin (login required):
- Create seasons
- Create players
- Create matches (draft)
- Enter match results (E/S/W/N + raw points)
- Finalize match (computes placement + club_points + ratings; makes it public)
- Import season matches from Excel on `/admin/seasons`

## Setup
1) Create a Supabase project.
2) Run the schema SQL (mahjong_supabase_schema.sql) in Supabase SQL Editor.
3) Copy `.env.example` -> `.env` and fill:
   - PUBLIC_SUPABASE_URL
   - PUBLIC_SUPABASE_ANON_KEY
4) Install and run:
   - `npm install`
   - `npm run dev`

## Promote an admin
After signing up once, set your auth user's profile row:
```sql
update public.profiles set is_admin=true where id = '<auth-user-uuid>';
```

## Notes
- Public pages query read-only views:
  - v_season_standings, v_season_player_stats, v_player_match_history,
    v_player_point_history, v_rating_history, v_final_results
- Admin pages write to base tables and call the `finalize_match` RPC.

## Excel import format
Use `/admin/seasons` -> `Import season matches (Excel)` and upload a workbook with this header:

`Date, Game, Tbl, E Player, S Player, W Player, N Player, E Pts, S Pts, W Pts, N Pts, Ex`

- `Date`: `M/D/YYYY` (example `2/4/2026`) or Excel date cell
- `Game`: positive integer
- `Tbl`: `A` (automatic table) or `M` (manual)
- `Players`: real first name (or full display name)
- `Pts`: raw points per seat
- `Ex`: extra out-of-play sticks (integer >= 0)

Importer behavior:
- If a player first name does not exist, importer auto-creates a player with:
  - `real_first_name` = imported value
  - display defaults set to show first name
- If a name matches multiple players, import fails with an ambiguity error.

Player naming model:
- `display_name` is optional
- `real_first_name` is optional
- `real_last_name` is optional
- At least one of `display_name` or `real_first_name` must exist
- Players can choose visibility flags for display/first/last (must show display or first)

For existing databases, run:

1. `supabase/migrations/20260219_add_match_import_fields.sql`
2. `supabase/migrations/20260219_rework_players_identity.sql`
3. `supabase/migrations/20260220_fix_rating_state_conflict_targets.sql`
