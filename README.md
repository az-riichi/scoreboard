# Mahjong Club Webapp — SvelteKit + Supabase (Schema v1.1)

Frontend implementation for the database schema (seasons/players/matches/results/standings/ratings).

## Features
Public (no login required):
- Seasons list
- Season standings (cumulative points + basic stats)
- Player page: season stats + match history + cumulative point history + rating history
- Match page: final results (E/S/W/N seats)

Admin (login required, `profiles.is_admin=true`):
- Create seasons
- Create players
- Create matches (draft)
- Enter match results (E/S/W/N + raw points)
- Finalize match (computes placement + club_points + ratings; makes it public)

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
