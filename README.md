# AZRM Scoreboard

SvelteKit frontend for the AZ Riichi Mahjong database (seasons, players, matches, standings, and ratings).

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

## Prerequisites

- Node.js 22 or newer
- pnpm 11.15.1 (install it directly, or use Corepack on Node versions that bundle Corepack)
- A Supabase project

## Local setup

1. Activate the package manager declared in `package.json` (or install pnpm 11.15.1 directly), then install the locked dependencies:

   ```sh
   corepack enable # where Corepack is available
   pnpm install --frozen-lockfile
   ```

2. Copy `.env.example` to `.env` and set:

   ```dotenv
   PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   ```

   Use the project's public anon key, never its service-role key.

   Netlify does not load the local `.env` file. Set both variables in the site's build environment before deploying.

3. Initialize the database as described below.

4. Start the development server:

   ```sh
   pnpm dev
   ```

Run the same validation used by Netlify before submitting changes:

```sh
pnpm run ci
```

## Database schema and migrations

For a new Supabase project, run `supabase/mahjong_supabase_schema.sql` in the SQL Editor. It is the consolidated baseline for fresh installs, so do not replay the historical migrations on top of it.

For an existing project, apply each not-yet-deployed file in `supabase/migrations/` in filename order. Record which migration was last deployed; do not blindly replay data-rebuild migrations against a production database. Migration files are tracked in Git and should be committed with the application change that depends on them.

When changing the database, update both the consolidated schema and an ordered migration for existing deployments. Before applying database changes, take a backup and test the migration against a non-production project. The application expects the schema and all applicable migrations from this repository to be deployed together.

## Promote an admin

After signing up once, set your auth user's profile row:

```sql
update public.profiles set is_admin=true where id = '<auth-user-uuid>';
```

## Notes

- Public pages query read-only views:
  - v_season_standings, v_season_player_stats, v_player_match_history,
    v_player_point_history, v_rating_history, v_current_ratings, v_final_results,
    and the redacted v_public_players projection
- Admin pages write through restricted tables and transaction-safe RPCs for finalizing/deleting matches,
  rebuilding ratings, activating seasons, and linking player accounts.

## Excel import format

Use `/admin/seasons` -> `Import season matches (Excel)` and upload a workbook with this header:

`Date, Game, Tbl, E Player, S Player, W Player, N Player, E Pts, S Pts, W Pts, N Pts, Ex`

- `Date`: `M/D/YYYY` (example `2/4/2026`) or Excel date cell
- `Game`: positive integer
- `Tbl`: `A` (automatic table) or `M` (manual)
- `Players`: real first name (or full display name)
- `Pts`: raw points per seat
- `Ex`: extra points held outside the four player totals (integer >= 0, normally in 1,000-point increments)

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
