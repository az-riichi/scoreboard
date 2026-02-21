<script lang="ts">
  import { fmtPct, fmtNum, fmtDateTime } from '$lib/ui';
  export let data: any;

  type SortKey = 'rank' | 'player' | 'rating' | 'sp' | 'games' | 'avg' | 'top2';
  type SortDir = 'asc' | 'desc';

  let sortKey: SortKey = 'rank';
  let sortDir: SortDir = 'asc';

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

  $: sortedStandings = [...(data.standings ?? [])].sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'rank') cmp = cmpNullableNum(numOrNull(a?.rank), numOrNull(b?.rank), sortDir);
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
    <div class="muted">Ranked by Season Points (SP), after adjustments. SP resets each season, Rating (R) does not reset.</div>
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
        {#each sortedStandings as row}
          <tr>
            <td>{row.rank}</td>
            <td>
              <a href={`/player/${row.player_id}?season=${data.season.id}`} style="text-decoration:none;">
                {row.player_name_primary}
                {#if row.player_name_secondary}
                  <span class="muted" style="margin-left:6px;">({row.player_name_secondary})</span>
                {/if}
              </a>
            </td>
            <td>{fmtFixed(row.total_points_with_adjustments, 1)}</td>
            <td>{row.rating == null ? '—' : fmtNum(row.rating, 0)}</td>
            <td>{row.games_played}</td>
            <td>{fmtFixed(row.avg_placement, 2)}</td>
            <td>{fmtPct(row.top2_rate)}</td>
          </tr>
        {/each}
        {#if sortedStandings.length === 0}
          <tr><td colspan="7" class="muted">No finalized matches yet.</td></tr>
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
            <td><a href={`/match/${m.id}`} style="text-decoration:none;">{m.table_label ?? m.id.slice(0, 8)}</a></td>
            <td>{m.winner_name ?? '—'}</td>
            <td>{m.top_raw_points == null ? '—' : fmtNum(m.top_raw_points, 0)}</td>
            <td>{m.sp_spread == null ? '—' : fmtNum(m.sp_spread, 1)}</td>
          </tr>
        {/each}
        {#if data.recentMatches.length === 0}
          <tr><td colspan="6" class="muted">No matches yet.</td></tr>
        {/if}
      </tbody>
    </table>
  </div>
</div>
