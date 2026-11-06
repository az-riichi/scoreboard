<script lang="ts">
  import { tick } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import MatchSummaryTable from '$lib/MatchSummaryTable.svelte';
  import { fmtPct, fmtNum, fmtFixed, fmtSigned, signTone } from '$lib/ui';
  import { seasonKanji } from '$lib/mahjong';
  import {
    rememberSeasonView,
    returningSeasonView,
    type SeasonView,
    type SortDir,
    type SortKey,
    type StandingsView
  } from '$lib/season-return';
  import type { Snapshot } from './$types';
  export let data: any;

  const returning = returningSeasonView();
  let sortKey: SortKey = returning?.sortKey ?? 'rank';
  let sortDir: SortDir = returning?.sortDir ?? 'asc';
  let standingsView: StandingsView = returning?.standingsView ?? (data.isCasual ? 'all' : 'eligible');
  let standingsSeasonId = data.season.id;

  function currentView(): SeasonView {
    return { scrollY: window.scrollY, sortKey, sortDir, standingsView };
  }

  beforeNavigate(({ from }) => {
    if (from) rememberSeasonView(from.url, currentView());
  });

  // Covers the browser's Back and Forward buttons and reloads. SvelteKit scrolls before it
  // restores this, when the page can still be too short to reach the saved position.
  export const snapshot: Snapshot<SeasonView> = {
    capture: currentView,
    async restore(view) {
      ({ sortKey, sortDir, standingsView } = view);
      await tick();
      window.scrollTo(0, view.scrollY);
    }
  };

  $: if (data.season.id !== standingsSeasonId) {
    standingsSeasonId = data.season.id;
    standingsView = data.isCasual ? 'all' : 'eligible';
  }

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

  function ariaSort(key: SortKey, activeKey: SortKey, dir: SortDir) {
    if (key !== activeKey) return undefined;
    return dir === 'asc' ? 'ascending' : 'descending';
  }

  function numOrNull(v: unknown): number | null {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function cmpNullableNum(a: number | null, b: number | null, dir: SortDir) {
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    return dir === 'asc' ? a - b : b - a;
  }

  function playerHref(playerId: string) {
    const eventQuery = data.isCasual && data.eventId ? `&event=${encodeURIComponent(data.eventId)}` : '';
    return `/player/${playerId}?season=${data.season.id}${eventQuery}`;
  }

  function eligibleGames(row: any) {
    return (numOrNull(row?.games_played) ?? 0) > 4;
  }

  $: eligibleRankByPlayerId = (() => {
    const map = new Map<string, number>();
    if (data.isCasual) return map;
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
    if (data.isCasual) return numOrNull(row?.rank);
    const playerId = String(row?.player_id ?? '').trim();
    if (!playerId) return null;
    return eligibleRankByPlayerId.get(playerId) ?? null;
  }

  function submitEventFilter(event: Event) {
    (event.currentTarget as HTMLSelectElement).form?.requestSubmit();
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
  $: visibleStandings = data.isCasual || standingsView === 'all' ? sortedStandings : eligibleStandings;
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
    font-weight: 600;
    letter-spacing: inherit;
    text-transform: inherit;
    white-space: nowrap;
  }
  .sort-head-btn.is-sorted,
  .sort-head-btn:hover {
    color: var(--text);
  }
  .sort-indicator {
    display: inline-block;
    margin-left: 6px;
    min-width: 1ch;
    color: var(--accent);
  }
  .num .sort-head-btn {
    text-align: right;
  }
  .season-card {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 14px 20px;
    flex-wrap: wrap;
  }
  .season-card .muted {
    margin-top: 4px;
  }
  .season-controls {
    display: flex;
    gap: 10px 14px;
    align-items: center;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .event-filter {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .standings-view-toggle {
    margin-top: 12px;
  }
  .standings-row-link {
    display: block;
    margin: -9px -8px;
    padding: 9px 8px;
    text-decoration: none;
    color: inherit;
    transition: background-color 120ms ease, text-decoration-color 120ms ease;
  }
  .standings-row-link:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .standings-table tbody tr {
    transition: background-color 120ms ease;
  }
  .standings-table tbody tr:hover,
  .standings-table tbody tr:focus-within {
    background: var(--row-hover);
  }
  .standings-table .cell-player {
    overflow-wrap: anywhere;
  }
  @media (max-width: 760px) {
    .standings-table .col-standings-top2 {
      display: none;
    }
  }
  @media (max-width: 680px) {
    .standings-table .col-standings-avg {
      display: none;
    }
  }
  @media (max-width: 500px) {
    .standings-table .col-standings-games {
      display: none;
    }
    .standings-table .col-standings-rank {
      width: 56px !important;
    }
    .standings-table .col-standings-sp {
      width: 78px !important;
    }
    .standings-table .col-standings-player-head {
      width: auto !important;
    }
    .standings-table th,
    .standings-table td {
      padding-left: 6px;
      padding-right: 6px;
    }
    .standings-row-link {
      margin-left: -6px;
      margin-right: -6px;
      padding-left: 6px;
      padding-right: 6px;
    }
  }

  @media (max-width: 400px) {
    .standings-table .col-standings-rating {
      display: none;
    }
  }
</style>

<div class="card season-card" style="margin-bottom:12px;">
  <div>
    <div class="title-row">
      <span class="led-tag" lang="ja" aria-hidden="true">{seasonKanji(data.season.name, data.isCasual)}</span>
      <h1 class="page-title">{data.season.name}</h1>
    </div>
    {#if !data.isCasual}
      <div class="muted">{data.season.start_date} → {data.season.end_date}</div>
    {/if}
  </div>
  <div class="season-controls">
    {#if data.competitiveSeason && data.casualSeason}
      <nav class="seg" aria-label="Scoreboard mode">
        <a
          class:is-active={data.season.id === data.competitiveSeason.id}
          aria-current={data.season.id === data.competitiveSeason.id ? 'page' : undefined}
          href={`/season/${data.competitiveSeason.id}`}
        >
          Competition
        </a>
        <a
          class:is-active={data.season.id === data.casualSeason.id}
          aria-current={data.season.id === data.casualSeason.id ? 'page' : undefined}
          href={`/season/${data.casualSeason.id}`}
        >
          Casual
        </a>
      </nav>
    {/if}
    {#if data.isCasual}
      <form method="GET">
        <label class="event-filter">
          <span class="muted">Event</span>
          <select name="event" value={data.eventId ?? ''} on:change={submitEventFilter}>
            <option value="">All events</option>
            {#each data.events as event}
              <option value={event.id}>{event.name}</option>
            {/each}
          </select>
        </label>
      </form>
    {:else if data.season.is_active}
      <span class="status-live"><span class="led-dot is-on is-blink" aria-hidden="true"></span>Active</span>
    {/if}
  </div>
</div>

<div class="card" style="margin-bottom:12px;">
  <div>
    <div class="title-row">
      <span class="led-tag" lang="ja" aria-hidden="true">順位表</span>
      <h2 class="card-title">Standings</h2>
    </div>
    {#if !data.isCasual}
      <div class="muted" style="margin-top:4px;">5+ games to rank</div>
      <div class="chips standings-view-toggle" role="tablist" aria-label="Standings list filter">
        <button
          type="button"
          role="tab"
          class="chip"
          aria-selected={standingsView === 'eligible'}
          on:click={() => (standingsView = 'eligible')}
        >
          Eligible ({eligibleStandings.length})
        </button>
        <button
          type="button"
          role="tab"
          class="chip"
          aria-selected={standingsView === 'all'}
          on:click={() => (standingsView = 'all')}
        >
          All players ({sortedStandings.length})
        </button>
      </div>
    {/if}
  </div>

  <div style="margin-top:12px; overflow:auto;">
    <table class="standings-table">
      <thead>
        <tr>
          <th class="col-standings-rank" style="width:72px;" aria-sort={ariaSort('rank', sortKey, sortDir)}>
            <button class="sort-head-btn" class:is-sorted={sortKey === 'rank'} type="button" on:click={() => toggleSort('rank')}>
              Rank
              {#if sortKey === 'rank'}
                <span class="sort-indicator">{sortDir === 'asc' ? '↑' : '↓'}</span>
              {/if}
            </button>
          </th>
          <th class="col-standings-player-head" style="width:200px;" aria-sort={ariaSort('player', sortKey, sortDir)}>
            <button class="sort-head-btn" class:is-sorted={sortKey === 'player'} type="button" on:click={() => toggleSort('player')}>
              Player
              {#if sortKey === 'player'}
                <span class="sort-indicator">{sortDir === 'asc' ? '↑' : '↓'}</span>
              {/if}
            </button>
          </th>
          <th class="col-standings-sp num" style="width:100px;" aria-sort={ariaSort('sp', sortKey, sortDir)}>
            <button class="sort-head-btn" class:is-sorted={sortKey === 'sp'} type="button" on:click={() => toggleSort('sp')}>
              SP
              {#if sortKey === 'sp'}
                <span class="sort-indicator">{sortDir === 'asc' ? '↑' : '↓'}</span>
              {/if}
            </button>
          </th>
          {#if !data.isCasual}
            <th class="col-standings-rating num" style="width:90px;" aria-sort={ariaSort('rating', sortKey, sortDir)}>
              <button class="sort-head-btn" class:is-sorted={sortKey === 'rating'} type="button" on:click={() => toggleSort('rating')}>
                R
                {#if sortKey === 'rating'}
                  <span class="sort-indicator">{sortDir === 'asc' ? '↑' : '↓'}</span>
                {/if}
              </button>
            </th>
          {/if}
          <th class="col-standings-games num" style="width:80px;" aria-sort={ariaSort('games', sortKey, sortDir)}>
            <button class="sort-head-btn" class:is-sorted={sortKey === 'games'} type="button" on:click={() => toggleSort('games')}>
              Games
              {#if sortKey === 'games'}
                <span class="sort-indicator">{sortDir === 'asc' ? '↑' : '↓'}</span>
              {/if}
            </button>
          </th>
          <th class="col-standings-avg num" style="width:110px;" aria-sort={ariaSort('avg', sortKey, sortDir)}>
            <button class="sort-head-btn" class:is-sorted={sortKey === 'avg'} type="button" on:click={() => toggleSort('avg')}>
              Avg place
              {#if sortKey === 'avg'}
                <span class="sort-indicator">{sortDir === 'asc' ? '↑' : '↓'}</span>
              {/if}
            </button>
          </th>
          <th class="col-standings-top2 num" style="width:100px;" aria-sort={ariaSort('top2', sortKey, sortDir)}>
            <button class="sort-head-btn" class:is-sorted={sortKey === 'top2'} type="button" on:click={() => toggleSort('top2')}>
              Top2%
              {#if sortKey === 'top2'}
                <span class="sort-indicator">{sortDir === 'asc' ? '↑' : '↓'}</span>
              {/if}
            </button>
          </th>
        </tr>
      </thead>
      <tbody>
        {#each visibleStandings as row (row.player_id)}
          {@const href = playerHref(row.player_id)}
          {@const rank = displayRank(row)}
          {@const spTone = signTone(row.total_points_with_adjustments, 1)}
          <tr>
            <td>
              <a class="standings-row-link" {href} tabindex="-1"><span class="rank-led" data-rank={rank}>{rank ?? '-'}</span></a>
            </td>
            <td class="cell-player">
              <a class="standings-row-link" {href}>
                {row.player_name_primary}
                {#if row.player_name_secondary}
                  <span class="muted" style="margin-left:6px;">({row.player_name_secondary})</span>
                {/if}
              </a>
            </td>
            <td class="num">
              <a class="standings-row-link" {href} tabindex="-1">
                <span class="led" class:led-pos={spTone === 'pos'} class:led-neg={spTone === 'neg'}>{fmtSigned(row.total_points_with_adjustments, 1, true)}</span>
              </a>
            </td>
            {#if !data.isCasual}
              <td class="col-standings-rating num"><a class="standings-row-link" {href} tabindex="-1">{row.rating == null ? '—' : fmtNum(row.rating, 0)}</a></td>
            {/if}
            <td class="col-standings-games num"><a class="standings-row-link" {href} tabindex="-1">{row.games_played}</a></td>
            <td class="col-standings-avg num"><a class="standings-row-link" {href} tabindex="-1">{fmtFixed(row.avg_placement, 2)}</a></td>
            <td class="col-standings-top2 num"><a class="standings-row-link" {href} tabindex="-1">{fmtPct(row.top2_rate)}</a></td>
          </tr>
        {/each}
        {#if visibleStandings.length === 0}
          <tr>
            <td colspan={data.isCasual ? 6 : 7} class="muted">
              {!data.isCasual && standingsView === 'eligible'
                ? 'No players with 5+ games yet.'
                : data.eventId
                  ? 'No finalized matches in this event yet.'
                  : 'No finalized matches yet.'}
            </td>
          </tr>
        {/if}
      </tbody>
    </table>
  </div>
</div>

<div class="card">
  <div class="card-head">
    <div>
      <div class="title-row">
        <span class="led-tag" lang="ja" aria-hidden="true">最近の対局</span>
        <h2 class="card-title">Recent matches</h2>
      </div>
    </div>
    {#if data.matchCount > 0}
      <a
        class="btn"
        href={`/season/${data.season.id}/matches${data.eventId ? `?event=${encodeURIComponent(data.eventId)}` : ''}`}
      >
        All matches ({data.matchCount})
      </a>
    {/if}
  </div>

  <div style="margin-top:12px; overflow:auto;">
    <MatchSummaryTable matches={data.recentMatches} seasonId={data.season.id} eventId={data.eventId} />
  </div>
</div>
