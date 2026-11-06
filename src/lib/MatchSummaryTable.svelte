<script lang="ts">
  import { clickableRow } from '$lib/clickable-row';
  import { fmtDate, fmtNum } from '$lib/ui';
  import type { RecentMatchSummary } from '$lib/public-data/types';

  export let matches: RecentMatchSummary[];
  export let seasonId: string;
  export let eventId: string | null = null;

  function playerHref(playerId: string) {
    const eventQuery = eventId ? `&event=${encodeURIComponent(eventId)}` : '';
    return `/player/${playerId}?season=${seasonId}${eventQuery}`;
  }
</script>

<style>
  .match-cell-link {
    display: block;
    margin: -9px -8px;
    padding: 9px 8px;
    text-decoration: none;
    color: inherit;
    transition: background-color 120ms ease, text-decoration-color 120ms ease;
  }
  .match-cell-link:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .match-cell-link:hover,
  .match-cell-link:focus-visible {
    color: var(--accent);
  }
  .cell-wrap {
    overflow-wrap: anywhere;
  }
  @media (max-width: 760px) {
    .col-sp {
      display: none;
    }
  }
  @media (max-width: 680px) {
    .col-top {
      display: none;
    }
  }
  @media (max-width: 500px) {
    th,
    td {
      padding-left: 6px;
      padding-right: 6px;
    }
    .match-cell-link {
      margin-left: -6px;
      margin-right: -6px;
      padding-left: 6px;
      padding-right: 6px;
    }
  }
</style>

<table>
  <thead>
    <tr>
      <th>Date</th>
      <th>Match</th>
      <th>Winner</th>
      <th class="col-top num" style="width:100px;">Top score</th>
      <th class="col-sp num" style="width:100px;">SP spread</th>
    </tr>
  </thead>
  <tbody>
    {#each matches as m (m.id)}
      <tr use:clickableRow={`/match/${m.id}`}>
        <td>{fmtDate(m.played_at)}</td>
        <td class="cell-wrap"><a class="match-cell-link" href={`/match/${m.id}`}>{m.table_label ?? m.id.slice(0, 8)}</a></td>
        <td class="cell-wrap">
          {#if m.winner_player_id}
            <a class="match-cell-link" href={playerHref(m.winner_player_id)}>
              {m.winner_name_primary ?? m.winner_name ?? '—'}
              {#if m.winner_name_secondary}
                <span class="muted" style="margin-left:6px;">({m.winner_name_secondary})</span>
              {/if}
            </a>
          {:else}
            {m.winner_name_primary ?? m.winner_name ?? '—'}
            {#if m.winner_name_secondary}
              <span class="muted" style="margin-left:6px;">({m.winner_name_secondary})</span>
            {/if}
          {/if}
        </td>
        <td class="col-top num">
          {#if m.top_raw_points == null}
            —
          {:else}
            <span class="led led-red">{fmtNum(m.top_raw_points, 0)}</span>
          {/if}
        </td>
        <td class="col-sp num">{m.sp_spread == null ? '—' : fmtNum(m.sp_spread, 1)}</td>
      </tr>
    {/each}
    {#if matches.length === 0}
      <tr><td colspan="5" class="muted">No matches yet.</td></tr>
    {/if}
  </tbody>
</table>
