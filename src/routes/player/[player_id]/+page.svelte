<script lang="ts">
  import { fmtDateTime, fmtNum, fmtPct } from '$lib/ui';
  export let data: any;

  let season = data.seasonId;
</script>

<div class="card" style="margin-bottom:12px;">
  <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:end;">
    <div>
      <div style="font-size:1.15rem; font-weight:700;">{data.player.display_name}</div>
      <div class="muted">Player profile</div>
    </div>

    <form method="GET" style="display:flex; gap:10px; align-items:end;">
      <label>
        <div class="muted">Season</div>
        <select name="season" bind:value={season} style="min-width:240px;">
          {#each data.seasons as s}
            <option value={s.id}>{s.name}</option>
          {/each}
        </select>
      </label>
      <button class="btn" type="submit">View</button>
    </form>
  </div>
</div>

{#if !data.seasonId}
  <div class="card">No active season found.</div>
{:else}
  <div class="grid2" style="margin-bottom:12px;">
    <div class="card">
      <div style="font-size:1.05rem; font-weight:650;">Season snapshot</div>
      <div class="muted">Rank + totals in this season.</div>

      <div style="display:grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap:10px; margin-top:12px;">
        <div class="card" style="border-radius:14px;">
          <div class="muted">Rank</div>
          <div style="font-size:1.3rem; font-weight:700;">{data.standingsRow?.rank ?? '-'}</div>
        </div>
        <div class="card" style="border-radius:14px;">
          <div class="muted">Total</div>
          <div style="font-size:1.3rem; font-weight:700;">{fmtNum(data.stats?.total_points, 2)}</div>
        </div>
        <div class="card" style="border-radius:14px;">
          <div class="muted">Games</div>
          <div style="font-size:1.3rem; font-weight:700;">{data.stats?.games_played ?? 0}</div>
        </div>
      </div>

      <div style="margin-top:12px;">
        <div class="muted">Avg placement: {fmtNum(data.stats?.avg_placement, 2)}</div>
        <div class="muted">Avg points: {fmtNum(data.stats?.avg_points, 2)}</div>
        <div class="muted">Top2% (rentai): {fmtPct(data.stats?.top2_rate)}</div>
        <div class="muted">#1/#2/#3/#4: {data.stats?.firsts ?? 0}/{data.stats?.seconds ?? 0}/{data.stats?.thirds ?? 0}/{data.stats?.fourths ?? 0}</div>
      </div>
    </div>

    <div class="card">
      <div style="font-size:1.05rem; font-weight:650;">Best / worst</div>
      <div class="muted">Best and worst match by club points.</div>

      <div style="margin-top:12px; display:grid; gap:10px;">
        <div class="card" style="border-radius:14px;">
          <div class="muted">Best</div>
          <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;">
            <div style="font-size:1.1rem; font-weight:700;">{fmtNum(data.stats?.best_points, 2)}</div>
            {#if data.stats?.best_match_id}
              <a class="btn" href={`/match/${data.stats.best_match_id}`} style="text-decoration:none;">View match</a>
            {/if}
          </div>
          <div class="muted">{data.stats?.best_played_at ? fmtDateTime(data.stats.best_played_at) : ''}</div>
        </div>

        <div class="card" style="border-radius:14px;">
          <div class="muted">Worst</div>
          <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;">
            <div style="font-size:1.1rem; font-weight:700;">{fmtNum(data.stats?.worst_points, 2)}</div>
            {#if data.stats?.worst_match_id}
              <a class="btn" href={`/match/${data.stats.worst_match_id}`} style="text-decoration:none;">View match</a>
            {/if}
          </div>
          <div class="muted">{data.stats?.worst_played_at ? fmtDateTime(data.stats.worst_played_at) : ''}</div>
        </div>
      </div>
    </div>
  </div>

  <div class="grid2">
    <div class="card">
      <div style="font-size:1.05rem; font-weight:650;">Recent matches</div>
      <div class="muted">Last 100 matches (most recent first).</div>

      <div style="margin-top:12px; overflow:auto; max-height: 520px;">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Match</th>
              <th style="width:80px;">Seat</th>
              <th style="width:100px;">Place</th>
              <th style="width:120px;">Pts</th>
            </tr>
          </thead>
          <tbody>
            {#each data.matchHistory as r}
              <tr>
                <td>{fmtDateTime(r.played_at)}</td>
                <td><a href={`/match/${r.match_id}`} style="text-decoration:none;">{r.match_id.slice(0,8)}</a></td>
                <td>{r.seat}</td>
                <td>{r.placement}</td>
                <td>{fmtNum(r.club_points, 2)}</td>
              </tr>
            {/each}
            {#if data.matchHistory.length === 0}
              <tr><td colspan="5" class="muted">No matches recorded.</td></tr>
            {/if}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div style="font-size:1.05rem; font-weight:650;">Histories</div>
      <div class="muted">Cumulative points and rating deltas (tables ready for charts).</div>

      <h4 style="margin:12px 0 8px;">Cumulative points</h4>
      <div style="overflow:auto; max-height: 240px;">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th style="width:120px;">Delta</th>
              <th style="width:160px;">Cumulative</th>
            </tr>
          </thead>
          <tbody>
            {#each data.pointHistory as row}
              <tr>
                <td><a href={`/match/${row.match_id}`} style="text-decoration:none;">{fmtDateTime(row.played_at)}</a></td>
                <td>{fmtNum(row.club_points, 2)}</td>
                <td>{fmtNum(row.cumulative_points, 2)}</td>
              </tr>
            {/each}
            {#if data.pointHistory.length === 0}
              <tr><td colspan="3" class="muted">No data.</td></tr>
            {/if}
          </tbody>
        </table>
      </div>

      <h4 style="margin:12px 0 8px;">R rating history</h4>
      <div style="overflow:auto; max-height: 240px;">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th style="width:80px;">Place</th>
              <th style="width:140px;">ΔR</th>
              <th style="width:140px;">R</th>
            </tr>
          </thead>
          <tbody>
            {#each data.ratingHistory as row}
              <tr>
                <td><a href={`/match/${row.match_id}`} style="text-decoration:none;">{fmtDateTime(row.played_at)}</a></td>
                <td>{row.placement}</td>
                <td>{fmtNum(row.delta, 2)}</td>
                <td>{fmtNum(row.new_rate, 2)}</td>
              </tr>
            {/each}
            {#if data.ratingHistory.length === 0}
              <tr><td colspan="4" class="muted">No rating events yet.</td></tr>
            {/if}
          </tbody>
        </table>
      </div>
    </div>
  </div>
{/if}
