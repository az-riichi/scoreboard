# AZRM Scoreboard

SvelteKit frontend for the AZ Riichi Mahjong database (seasons, players, matches, standings, and ratings).

## Features

Public (no login required):

- Seasons list
- Season standings (cumulative points + basic stats)
- Timeless Casual category whose games can be grouped and filtered by event and never change season or lifetime ratings
- Player page: season/event stats plus togglable SP/R and placement history charts (placement-only for Casual)
- Match page: final results (E/S/W/N seats)

Admin (login required):

- Create seasons
- Create players
- Create matches (draft)
- Create or select a Casual event while entering a match
- Enter match results (E/S/W/N + raw points)
- Finalize match (computes placement + club_points, updates ratings for regular seasons, and makes it public)
- Import season matches from Excel on `/admin/seasons`
- Issue, review, and revoke private strikes, suspensions, and bans on `/admin/discipline`
- Grant granular admin permissions on `/admin/permissions`

Linked players (login required):

- Review their private current discipline status, effective dates, reasons, and action history on `/discipline`

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

For the public-cache upgrade, use this rolling order on an existing live
deployment so neither application version loses its data source:

1. Apply `20260727_add_public_data_revision.sql`.
2. Deploy the updated application.
3. Apply `20260727_remove_public_analytics_views.sql`.

Fresh installations should use the consolidated schema as usual.

## Bootstrap the owner

After signing up once, explicitly make the trusted account the owner:

```sql
update public.profiles
set admin_role = 'owner',
    admin_permissions = '{}',
    is_admin = true
where id = '<auth-user-uuid>';
```

The owner has every admin permission and is the only account that can grant or
revoke super-admin status. Super admins have every ordinary permission. Other
admins receive only the permissions selected on `/admin/permissions`.

Upgrade migrations automatically convert every legacy `is_admin = true`
account to a super admin, but deliberately do not choose an owner. Bootstrap a
known owner with the SQL above after applying the permission migration.

## Notes

- Public pages conditionally synchronize one normalized, redacted snapshot and
  persist it in IndexedDB. Standings, match summaries, player statistics,
  histories, placements, SP, and display ratings are calculated in the browser.
- Each document load makes one cheap revision check. If the revision is
  unchanged, `/api/public-data` returns `304` with no dataset body and the
  IndexedDB snapshot is reused. A changed revision downloads and atomically
  replaces the snapshot once; child routes reuse the in-memory copy.
- `v_public_players` remains database-side as the privacy boundary for public
  names and profiles. The public snapshot never contains account links,
  unredacted player names, permissions, or discipline records.
- Admin pages write through restricted tables and transaction-safe RPCs for finalizing/deleting matches,
  rebuilding ratings, activating seasons, and linking player accounts.
- `Casual` is a singleton, date-unbounded season managed by the database. It cannot be active and its matches
  are excluded from both season (`SR`) and lifetime (`R`) rating state/history.

Database constraints, RLS, discipline eligibility, point-total validation,
atomic finalization/deletion, and serialized rating writes intentionally remain
authoritative on the server. The browser independently derives the public
read model from raw finalized records; it is never trusted to authorize or
commit competition results.

### Public data cache lifecycle

`public.public_data_revision` contains one `scoreboard` record. Narrow database
triggers advance it when public source data changes. Draft result entry does
not advance the revision; the final match status transition is its publication
boundary.

The browser stores the revision and snapshot in the
`azrm-scoreboard-public` IndexedDB database. Web Locks avoid duplicate refreshes
from tabs starting together, and `BroadcastChannel` invalidates stale in-memory
copies in other tabs. When the network is unavailable, the last complete local
snapshot remains usable. A failed or internally inconsistent refresh never
replaces it.

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

## Discipline rules

- A strike counts on its Arizona calendar date and for a rolling 30-day window through day 30, inclusive.
- A third non-revoked strike on one day, or a sixth within 30 inclusive calendar days, automatically issues a suspension when one is not already in effect.
- A suspension restricts competitive play for 14 calendar dates: its issue date through day 14, inclusive.
- More than two non-revoked suspensions automatically issues a permanent ban.
- Admins represent the president and designated officials. They can also issue any action directly or revoke any action with an audit reason.
- Suspended and banned players cannot be saved or finalized in competitive match results. Casual matches remain permitted.
- Discipline records are never exposed through the public scoreboard snapshot.
