<script lang="ts">
  import { fmtPct, fmtNum, fmtDateTime } from '$lib/ui';
  export let data: any;
</script>

<div class="card" style="margin-bottom:12px;">
  <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap;">
    <div>
      <div style="font-size:1.1rem; font-weight:650;">{data.season.name}</div>
      <div class="muted">{data.season.start_date} → {data.season.end_date}</div>
    </div>
    <div class="muted">{data.season.is_active ? 'Active season' : ''}</div>
  </div>
</div>

<div class="grid2">
  <div class="card">
    <div>
      <div style="font-size:1.05rem; font-weight:650;">Standings</div>
      <div class="muted">Ranked by total points (incl. adjustments).</div>
    </div>

    <div style="margin-top:12px; overflow:auto;">
      <table>
        <thead>
          <tr>
            <th style="width:70px;">Rank</th>
            <th>Player</th>
            <th style="width:150px;">Total</th>
            <th style="width:110px;">Games</th>
            <th style="width:110px;">Avg place</th>
            <th style="width:110px;">Top2%</th>
          </tr>
        </thead>
        <tbody>
          {#each data.standings as row}
            <tr>
              <td>{row.rank}</td>
              <td><a href={`/player/${row.player_id}?season=${data.season.id}`} style="text-decoration:none;">{row.display_name}</a></td>
              <td>{fmtNum(row.total_points_with_adjustments, 2)}</td>
              <td>{row.games_played}</td>
              <td>{fmtNum(row.avg_placement, 2)}</td>
              <td>{fmtPct(row.top2_rate)}</td>
            </tr>
          {/each}
          {#if data.standings.length === 0}
            <tr><td colspan="6" class="muted">No finalized matches yet.</td></tr>
          {/if}
        </tbody>
      </table>
    </div>
  </div>

  <div class="card">
    <div style="font-size:1.05rem; font-weight:650;">Recent matches</div>
    <div class="muted">Latest 25 finalized matches in this season.</div>

    <div style="margin-top:12px; overflow:auto;">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Match</th>
          </tr>
        </thead>
        <tbody>
          {#each data.recentMatches as m}
            <tr>
              <td>{fmtDateTime(m.played_at)}</td>
              <td><a href={`/match/${m.id}`} style="text-decoration:none;">{m.table_label ?? m.id.slice(0, 8)}</a></td>
            </tr>
          {/each}
          {#if data.recentMatches.length === 0}
            <tr><td colspan="2" class="muted">No matches yet.</td></tr>
          {/if}
        </tbody>
      </table>
    </div>
  </div>
</div>
