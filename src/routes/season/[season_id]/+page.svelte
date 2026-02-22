<script lang="ts">
  import { fmtPct, fmtNum, fmtDateTime } from '$lib/ui';
  export let data: any;

  type SortKey = 'rank' | 'player' | 'rating' | 'sp' | 'games' | 'avg' | 'top2';
  type SortDir = 'asc' | 'desc';
  type StandingsView = 'eligible' | 'all';

  let sortKey: SortKey = 'rank';
  let sortDir: SortDir = 'asc';
  let standingsView: StandingsView = 'eligible';

  const defaultDirByKey: Record<SortKey, SortDir> = {
    rank: 'asc',
    player: 'asc',
    rating: 'desc',
    sp: 'desc',
    games: 'desc',
    avg: 'asc',
    top2: 'desc'
  };

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      return;
    }
    sortKey = key;
    sortDir = defaultDirByKey[key];
  }

  function numOrNull(v: unknown): number | null {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function fmtFixed(x: unknown, digits: number) {
    const n = Number(x);
    if (!Number.isFinite(n)) return digits > 0 ? `0.${'0'.repeat(digits)}` : '0';
    return n.toLocaleString(undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function cmpNullableNum(a: number | null, b: number | null, dir: SortDir) {
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    return dir === 'asc' ? a - b : b - a;
  }

  function playerHref(playerId: string) {
    return `/player/${playerId}?season=${data.season.id}`;
  }

  function eligibleGames(row: any) {
    return (numOrNull(row?.games_played) ?? 0) > 4;
  }

  $: eligibleRankByPlayerId = (() => {
    const map = new Map<string, number>();
    const sourceRows = [...(data.standings ?? [])].sort((a, b) => {
      const rankCmp = cmpNullableNum(numOrNull(a?.rank), numOrNull(b?.rank), 'asc');
      if (rankCmp !== 0) return rankCmp;
      return String(a?.player_id ?? '').localeCompare(String(b?.player_id ?? ''));
    });
    const denseRankRemap = new Map<number, number>();
    let nextEligibleRank = 1;
    for (const row of sourceRows) {
      if (!eligibleGames(row)) continue;
      const playerId = String(row?.player_id ?? '').trim();
      const sourceRank = numOrNull(row?.rank);
      if (!playerId || sourceRank == null) continue;
      if (!denseRankRemap.has(sourceRank)) {
        denseRankRemap.set(sourceRank, nextEligibleRank);
        nextEligibleRank += 1;
      }
      map.set(playerId, denseRankRemap.get(sourceRank)!);
    }
    return map;
  })();

  function displayRank(row: any): number | null {
    const playerId = String(row?.player_id ?? '').trim();
    if (!playerId) return null;
    return eligibleRankByPlayerId.get(playerId) ?? null;
  }

  $: sortedStandings = [...(data.standings ?? [])].sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'rank') cmp = cmpNullableNum(displayRank(a), displayRank(b), sortDir);
    if (sortKey === 'player') {
      cmp = String(a?.player_name_primary ?? '').localeCompare(String(b?.player_name_primary ?? ''));
      if (sortDir === 'desc') cmp *= -1;
    }
    if (sortKey === 'rating') cmp = cmpNullableNum(numOrNull(a?.rating), numOrNull(b?.rating), sortDir);
    if (sortKey === 'sp') cmp = cmpNullableNum(numOrNull(a?.total_points_with_adjustments), numOrNull(b?.total_points_with_adjustments), sortDir);
    if (sortKey === 'games') cmp = cmpNullableNum(numOrNull(a?.games_played), numOrNull(b?.games_played), sortDir);
    if (sortKey === 'avg') cmp = cmpNullableNum(numOrNull(a?.avg_placement), numOrNull(b?.avg_placement), sortDir);
    if (sortKey === 'top2') cmp = cmpNullableNum(numOrNull(a?.top2_rate), numOrNull(b?.top2_rate), sortDir);

    if (cmp === 0) {
      cmp = cmpNullableNum(numOrNull(a?.rank), numOrNull(b?.rank), 'asc');
    }
    return cmp;
  });

  $: eligibleStandings = sortedStandings.filter((row) => eligibleGames(row));
  $: visibleStandings = standingsView === 'eligible' ? eligibleStandings : sortedStandings;
</script>

<style>
  .sort-head-btn {
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    padding: 0;
    cursor: pointer;
    text-align: left;
    font-weight: 650;
    white-space: nowrap;
  }
  .sort-indicator {
    display: inline-block;
    margin-left: 6px;
    min-width: 1ch;
    color: var(--muted);
  }
  .standings-view-toggle {
    display: inline-flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-top: 10px;
  }
  .standings-view-btn {
    border: 1px solid var(--btn-border);
    background: var(--btn-bg);
    color: inherit;
    border-radius: 999px;
    padding: 6px 10px;
    font: inherit;
    cursor: pointer;
    line-height: 1.1;
  }
  .standings-view-btn.is-active {
    background: var(--pill-bg);
    border-color: var(--pill-border);
    font-weight: 650;
  }
  .standings-row-link,
  .recent-cell-link {
    display: block;
    margin: -10px -8px;
    padding: 10px 8px;
    text-decoration: none;
    color: inherit;
    transition: background-color 120ms ease, text-decoration-color 120ms ease;
  }
  .standings-row-link:focus-visible,
  .recent-cell-link:focus-visible {
    outline: 2px solid var(--btn-border);
    outline-offset: -2px;
  }
  tbody tr:hover .standings-row-link,
  tbody tr:focus-within .standings-row-link {
    background: var(--pill-bg);
    text-decoration: none;
    text-decoration-color: var(--muted);
  }
  .recent-cell-link:hover,
  .recent-cell-link:focus-visible {
    background: var(--pill-bg);
    text-decoration: none;
    text-decoration-color: var(--muted);
  }
</style>

<div class="card" style="margin-bottom:12px;">
  <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap;">
    <div>
      <div style="font-size:1.1rem; font-weight:650;">{data.season.name}</div>
      <div class="muted">{data.season.start_date} → {data.season.end_date}</div>
    </div>
    <div class="muted">{data.season.is_active ? 'Active season' : ''}</div>
  </div>
</div>

<div class="card" style="margin-bottom:12px;">
  <div>
    <div style="font-size:1.05rem; font-weight:650;">Standings</div>
    <div class="muted">
      Ranked by Season Points (SP), after adjustments. SP resets each season,
      {#if data.isRatingSeason}
        Rating (R) does not reset.
      {:else}
        Rating (R) starts in the next season.
      {/if}
    </div>
    <div class="muted">A total of 5 or more games is required to be eligible for ranks in that season.</div>
    <div class="standings-view-toggle" role="tablist" aria-label="Standings list filter">
      <button
        type="button"
        role="tab"
        aria-selected={standingsView === 'eligible'}
        class="standings-view-btn {standingsView === 'eligible' ? 'is-active' : ''}"
        on:click={() => (standingsView = 'eligible')}
      >
        Eligible ({eligibleStandings.length})
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={standingsView === 'all'}
        class="standings-view-btn {standingsView === 'all' ? 'is-active' : ''}"
        on:click={() => (standingsView = 'all')}
      >
        All players ({sortedStandings.length})
      </button>
    </div>
  </div>

  <div style="margin-top:12px; overflow:auto;">
    <table>
      <thead>
        <tr>
          <th style="width:72px;">
            <button class="sort-head-btn" type="button" on:click={() => toggleSort('rank')}>
              Rank
              {#if sortKey === 'rank'}
                <span class="sort-indicator">{sortDir === 'asc' ? '↑' : '↓'}</span>
              {/if}
            </button>
          </th>
          <th style="width:250px;">
            <button class="sort-head-btn" type="button" on:click={() => toggleSort('player')}>
              Player
              {#if sortKey === 'player'}
                <span class="sort-indicator">{sortDir === 'asc' ? '↑' : '↓'}</span>
              {/if}
            </button>
          </th>
          <th style="width:100px;">
            <button class="sort-head-btn" type="button" on:click={() => toggleSort('sp')}>
              SP
              {#if sortKey === 'sp'}
                <span class="sort-indicator">{sortDir === 'asc' ? '↑' : '↓'}</span>
              {/if}
            </button>
          </th>
          <th style="width:100px;">
            <button class="sort-head-btn" type="button" on:click={() => toggleSort('rating')}>
              R
              {#if sortKey === 'rating'}
                <span class="sort-indicator">{sortDir === 'asc' ? '↑' : '↓'}</span>
              {/if}
            </button>
          </th>
          <th style="width:70px;">
            <button class="sort-head-btn" type="button" on:click={() => toggleSort('games')}>
              Games
              {#if sortKey === 'games'}
                <span class="sort-indicator">{sortDir === 'asc' ? '↑' : '↓'}</span>
              {/if}
            </button>
          </th>
          <th style="width:110px;">
            <button class="sort-head-btn" type="button" on:click={() => toggleSort('avg')}>
              Avg place
              {#if sortKey === 'avg'}
                <span class="sort-indicator">{sortDir === 'asc' ? '↑' : '↓'}</span>
              {/if}
            </button>
          </th>
          <th style="width:110px;">
            <button class="sort-head-btn" type="button" on:click={() => toggleSort('top2')}>
              Top2%
              {#if sortKey === 'top2'}
                <span class="sort-indicator">{sortDir === 'asc' ? '↑' : '↓'}</span>
              {/if}
            </button>
          </th>
        </tr>
      </thead>
      <tbody>
        {#each visibleStandings as row}
          <tr>
            <td>
              <a class="standings-row-link" href={playerHref(row.player_id)} tabindex="-1">{displayRank(row) ?? '-'}</a>
            </td>
            <td>
              <a class="standings-row-link" href={playerHref(row.player_id)}>
                {row.player_name_primary}
                {#if row.player_name_secondary}
                  <span class="muted" style="margin-left:6px;">({row.player_name_secondary})</span>
                {/if}
              </a>
            </td>
            <td><a class="standings-row-link" href={playerHref(row.player_id)} tabindex="-1">{fmtFixed(row.total_points_with_adjustments, 1)}</a></td>
            <td><a class="standings-row-link" href={playerHref(row.player_id)} tabindex="-1">{row.rating == null ? '—' : fmtNum(row.rating, 0)}</a></td>
            <td><a class="standings-row-link" href={playerHref(row.player_id)} tabindex="-1">{row.games_played}</a></td>
            <td><a class="standings-row-link" href={playerHref(row.player_id)} tabindex="-1">{fmtFixed(row.avg_placement, 2)}</a></td>
            <td><a class="standings-row-link" href={playerHref(row.player_id)} tabindex="-1">{fmtPct(row.top2_rate)}</a></td>
          </tr>
        {/each}
        {#if visibleStandings.length === 0}
          <tr>
            <td colspan="7" class="muted">
              {standingsView === 'eligible'
                ? 'No players with 5+ games yet.'
                : 'No finalized matches yet.'}
            </td>
          </tr>
        {/if}
      </tbody>
    </table>
  </div>
</div>

<div class="card">
  <div style="font-size:1.05rem; font-weight:650;">Recent matches</div>
  <div class="muted">Last 10 finalized matches.</div>

  <div style="margin-top:12px; overflow:auto;">
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Match</th>
          <th>Winner</th>
          <th style="width:90px;">Top score</th>
          <th style="width:100px;">SP spread</th>
        </tr>
      </thead>
      <tbody>
        {#each data.recentMatches as m}
          <tr>
            <td>{fmtDateTime(m.played_at)}</td>
            <td><a class="recent-cell-link" href={`/match/${m.id}`}>{m.table_label ?? m.id.slice(0, 8)}</a></td>
            <td>
              {#if m.winner_player_id}
                <a class="recent-cell-link" href={playerHref(m.winner_player_id)}>{m.winner_name ?? '—'}</a>
              {:else}
                {m.winner_name ?? '—'}
              {/if}
            </td>
            <td>{m.top_raw_points == null ? '—' : fmtNum(m.top_raw_points, 0)}</td>
            <td>{m.sp_spread == null ? '—' : fmtNum(m.sp_spread, 1)}</td>
          </tr>
        {/each}
        {#if data.recentMatches.length === 0}
          <tr><td colspan="5" class="muted">No matches yet.</td></tr>
        {/if}
      </tbody>
    </table>
  </div>
</div>
