<script lang="ts">
  import { fmtDateTime, fmtNum, fmtPct } from '$lib/ui';
  export let data: any;
  export let form: any;

  let season = data.seasonId;
  let display_name = data.player.display_name ?? '';
  let real_first_name = data.player.real_first_name ?? '';
  let real_last_name = data.player.real_last_name ?? '';
  let show_display_name = data.player.show_display_name ?? true;
  let show_real_first_name = data.player.show_real_first_name ?? false;
  let show_real_last_name = data.player.show_real_last_name ?? false;

  function fmtFixed2(x: number | null | undefined) {
    const n = Number(x);
    if (!Number.isFinite(n)) return '0.00';
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
</script>

<div class="card" style="margin-bottom:12px;">
  <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:end;">
    <div>
      <div style="font-size:1.15rem; font-weight:700;">{data.player.public_name}</div>
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

{#if form?.message}
  <div class="card alert alert-success">
    {form.message}
  </div>
{/if}

{#if data.canEditDisplay}
  <div class="card" style="margin-bottom:12px;">
    <div style="font-size:1.05rem; font-weight:650;">Your display settings</div>
    <div class="muted">Choose what appears publicly for this player profile.</div>

    <form method="POST" action="?/updateDisplay" style="display:flex; gap:10px; flex-wrap:wrap; align-items:end; margin-top:12px;">
      <label style="min-width:220px;">
        <div class="muted">Display name</div>
        <input name="display_name" bind:value={display_name} placeholder="Optional nickname" />
      </label>
      <label style="min-width:220px;">
        <div class="muted">Real first name</div>
        <input name="real_first_name" bind:value={real_first_name} placeholder="Optional first name" />
      </label>
      <label style="min-width:220px;">
        <div class="muted">Real last name</div>
        <input name="real_last_name" bind:value={real_last_name} placeholder="Optional last name" />
      </label>

      <label style="display:flex; gap:8px; align-items:center; padding:8px 0;">
        <input name="show_display_name" type="checkbox" bind:checked={show_display_name} />
        <span class="muted">Show display</span>
      </label>
      <label style="display:flex; gap:8px; align-items:center; padding:8px 0;">
        <input name="show_real_first_name" type="checkbox" bind:checked={show_real_first_name} />
        <span class="muted">Show first</span>
      </label>
      <label style="display:flex; gap:8px; align-items:center; padding:8px 0;">
        <input name="show_real_last_name" type="checkbox" bind:checked={show_real_last_name} />
        <span class="muted">Show last</span>
      </label>

      <button class="btn primary" type="submit">Save display settings</button>
    </form>
  </div>
{/if}

{#if !data.seasonId}
  <div class="card">No active season found.</div>
{:else}
  <div class="card" style="margin-bottom:12px;">
    <div class="muted">Current Rating (R)</div>
    <div style="font-size:2rem; font-weight:750; line-height:1.1; margin-top:4px;">
      {fmtFixed2(data.currentRating?.rate)}
    </div>
    <div class="muted" style="margin-top:4px;">
      Lifetime games: {data.currentRating?.games_played ?? 0}
    </div>
  </div>

  <div class="grid2" style="margin-bottom:12px;">
    <div class="card">
      <div style="font-size:1.05rem; font-weight:650;">Season snapshot</div>
      <div class="muted">Rank + Season Points (SP) in this season.</div>

      <div style="display:grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap:10px; margin-top:12px;">
        <div class="card" style="border-radius:14px;">
          <div class="muted">Rank</div>
          <div style="font-size:1.3rem; font-weight:700;">{data.standingsRow?.rank ?? '-'}</div>
        </div>
        <div class="card" style="border-radius:14px;">
          <div class="muted">Season Points (SP)</div>
          <div style="font-size:1.3rem; font-weight:700;">{fmtNum(data.standingsRow?.total_points_with_adjustments ?? data.stats?.total_points, 2)}</div>
        </div>
        <div class="card" style="border-radius:14px;">
          <div class="muted">Games</div>
          <div style="font-size:1.3rem; font-weight:700;">{data.stats?.games_played ?? 0}</div>
        </div>
      </div>

      <div style="margin-top:12px;">
        <div class="muted">Avg placement: {fmtFixed2(data.stats?.avg_placement)}</div>
        <div class="muted">Avg SP: {fmtNum(data.stats?.avg_points, 2)}</div>
        <div class="muted">Top2% (rentai): {fmtPct(data.stats?.top2_rate)}</div>
        <div class="muted">#1/#2/#3/#4: {data.stats?.firsts ?? 0}/{data.stats?.seconds ?? 0}/{data.stats?.thirds ?? 0}/{data.stats?.fourths ?? 0}</div>
      </div>
    </div>

    <div class="card">
      <div style="font-size:1.05rem; font-weight:650;">Best / worst</div>
      <div class="muted">Best and worst match by raw score.</div>

      <div style="margin-top:12px; display:grid; gap:10px;">
        <div class="card" style="border-radius:14px;">
          <div class="muted">Best</div>
          <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;">
            <div style="font-size:1.1rem; font-weight:700;">{data.bestRawMatch?.raw_points ?? '-'}</div>
            {#if data.bestRawMatch?.match_id}
              <a class="btn" href={`/match/${data.bestRawMatch.match_id}`} style="text-decoration:none;">View match</a>
            {/if}
          </div>
          <div class="muted">{data.bestRawMatch?.played_at ? fmtDateTime(data.bestRawMatch.played_at) : ''}</div>
        </div>

        <div class="card" style="border-radius:14px;">
          <div class="muted">Worst</div>
          <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;">
            <div style="font-size:1.1rem; font-weight:700;">{data.worstRawMatch?.raw_points ?? '-'}</div>
            {#if data.worstRawMatch?.match_id}
              <a class="btn" href={`/match/${data.worstRawMatch.match_id}`} style="text-decoration:none;">View match</a>
            {/if}
          </div>
          <div class="muted">{data.worstRawMatch?.played_at ? fmtDateTime(data.worstRawMatch.played_at) : ''}</div>
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
              <th style="width:120px;">SP Δ</th>
              <th style="width:120px;">ΔR</th>
            </tr>
          </thead>
          <tbody>
            {#each data.matchHistory as r}
              <tr>
                <td>{fmtDateTime(r.played_at)}</td>
                <td><a href={`/match/${r.match_id}`} style="text-decoration:none;">{r.match_label}</a></td>
                <td>{r.seat}</td>
                <td>{r.placement}</td>
                <td>{fmtNum(r.club_points, 2)}</td>
                <td>{r.rating_delta == null ? '—' : fmtNum(r.rating_delta, 2)}</td>
              </tr>
            {/each}
            {#if data.matchHistory.length === 0}
              <tr><td colspan="6" class="muted">No matches recorded.</td></tr>
            {/if}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div style="font-size:1.05rem; font-weight:650;">Histories</div>
      <div class="muted">Season Points (SP) reset each season. Rating (R) is lifetime.</div>

      <h4 style="margin:12px 0 8px;">Season Points (SP) history</h4>
      <div style="overflow:auto; max-height: 240px;">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th style="width:120px;">SP Δ</th>
              <th style="width:160px;">Cumulative SP</th>
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

      <h4 style="margin:12px 0 8px;">Rating (R) history (lifetime)</h4>
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
              <tr><td colspan="4" class="muted">No Rating (R) events yet.</td></tr>
            {/if}
          </tbody>
        </table>
      </div>
    </div>
  </div>
{/if}
