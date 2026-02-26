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
  let profileSettingsOpen = false;

  $: if (data.canEditDisplay && form?.message) {
    profileSettingsOpen = true;
  }

  type HistoryRange = '10' | '20' | '50' | 'all';
  type ChartPoint = { row: any; x: number; y: number };
  type GameTick = { key: string; ts: number; label: string; idx: number };

  const historyRangeOptions: { key: HistoryRange; label: string }[] = [
    { key: '10', label: 'Last 10' },
    { key: '20', label: 'Last 20' },
    { key: '50', label: 'Last 50' },
    { key: 'all', label: 'All time' }
  ];

  let historyRange: HistoryRange = '10';
  const chartWidth = 1280;
  const chartHeight = 500;
  const plot = { left: 64, right: 64, top: 18, bottom: 92 };

  function fmtFixed2(x: number | null | undefined) {
    const n = Number(x);
    if (!Number.isFinite(n)) return '0.00';
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function historySlice(rows: any[], range: HistoryRange) {
    if (range === 'all') return rows;
    const n = Number(range);
    if (!Number.isFinite(n) || n <= 0) return rows;
    return rows.slice(-n);
  }

  function toTime(value: unknown) {
    const t = new Date(String(value ?? '')).getTime();
    return Number.isFinite(t) ? t : null;
  }

  function seriesRange(values: number[], fallback: [number, number]): [number, number] {
    if (values.length === 0) return fallback;
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (min === max) {
      const bump = Math.max(Math.abs(min) * 0.05, 1);
      min -= bump;
      max += bump;
    }
    const pad = (max - min) * 0.08;
    return [min - pad, max + pad];
  }

  function pathFrom(points: ChartPoint[]) {
    if (points.length === 0) return '';
    return points
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
      .join(' ');
  }

  function spPointTooltip(row: any) {
    const label = String(row?.match_label ?? String(row?.match_id ?? '').slice(0, 8));
    const date = row?.played_at ? fmtDateTime(row.played_at) : '';
    return `${label}${date ? ` • ${date}` : ''}\nSP Δ ${fmtNum(row?.club_points, 2)} | Cum SP ${fmtNum(row?.cumulative_points, 2)}`;
  }

  function rPointTooltip(row: any) {
    const label = String(row?.match_label ?? String(row?.match_id ?? '').slice(0, 8));
    const date = row?.played_at ? fmtDateTime(row.played_at) : '';
    return `${label}${date ? ` • ${date}` : ''}\nPlace ${row?.placement ?? '-'} | ΔR ${fmtNum(row?.delta, 2)} | R ${fmtNum(row?.new_rate, 2)}`;
  }

  $: spRows = historySlice(data.pointHistory ?? [], historyRange);
  $: rRows = historySlice(data.ratingHistory ?? [], historyRange);
  $: plotWidth = chartWidth - plot.left - plot.right;
  $: plotHeight = chartHeight - plot.top - plot.bottom;
  $: spRange = seriesRange(
    spRows
      .map((row: any) => Number(row?.cumulative_points))
      .filter((v: number) => Number.isFinite(v)),
    [0, 1]
  );
  $: rRange = seriesRange(
    rRows
      .map((row: any) => Number(row?.new_rate))
      .filter((v: number) => Number.isFinite(v)),
    [0, 1]
  );

  function rowGameKey(row: any) {
    const matchId = String(row?.match_id ?? '').trim();
    if (matchId) return matchId;
    const ts = toTime(row?.played_at);
    return `t-${ts ?? 'na'}-${String(row?.played_at ?? '')}`;
  }

  function xAtIndex(idx: number, total: number) {
    if (total <= 1) return plot.left + plotWidth / 2;
    return plot.left + (idx / (total - 1)) * plotWidth;
  }

  function ySp(value: number) {
    const [yMin, yMax] = spRange;
    if (yMax === yMin) return plot.top + plotHeight / 2;
    return plot.top + (1 - (value - yMin) / (yMax - yMin)) * plotHeight;
  }

  function yR(value: number) {
    const [yMin, yMax] = rRange;
    if (yMax === yMin) return plot.top + plotHeight / 2;
    return plot.top + (1 - (value - yMin) / (yMax - yMin)) * plotHeight;
  }

  $: xGameTicks = (() => {
    const byMatch = new Map<string, { key: string; ts: number; label: string }>();
    for (const row of [...spRows, ...rRows]) {
      const ts = toTime(row?.played_at);
      if (ts == null) continue;
      const key = rowGameKey(row);
      if (byMatch.has(key)) continue;
      const fallbackLabel = String(row?.match_id ?? '').slice(0, 8) || 'Game';
      const label = String(row?.match_label ?? fallbackLabel).trim();
      byMatch.set(key, { key, ts, label });
    }
    return Array.from(byMatch.values())
      .sort((a, b) => a.ts - b.ts)
      .map((tick, idx) => ({ ...tick, idx }));
  })();
  $: xByGameKey = new Map<string, number>(
    xGameTicks.map((tick) => [tick.key, xAtIndex(tick.idx, xGameTicks.length)])
  );
  $: xTickStride = Math.max(1, Math.ceil(xGameTicks.length / 28));
  $: xAxisTicks = xGameTicks.filter((tick, i) => i % xTickStride === 0 || i === xGameTicks.length - 1);

  $: spPoints = spRows
    .map((row: any) => {
      const value = Number(row?.cumulative_points);
      if (!Number.isFinite(value)) return null;
      const x = xByGameKey.get(rowGameKey(row));
      if (x == null) return null;
      return { row, x, y: ySp(value) };
    })
    .filter((p: ChartPoint | null): p is ChartPoint => p !== null);

  $: rPoints = rRows
    .map((row: any) => {
      const value = Number(row?.new_rate);
      if (!Number.isFinite(value)) return null;
      const x = xByGameKey.get(rowGameKey(row));
      if (x == null) return null;
      return { row, x, y: yR(value) };
    })
    .filter((p: ChartPoint | null): p is ChartPoint => p !== null);

  $: spPath = pathFrom(spPoints);
  $: rPath = pathFrom(rPoints);
  $: hasHistoryData = spPoints.length > 0 || rPoints.length > 0;
  $: yGridYs = [0, 0.25, 0.5, 0.75, 1].map((t) => plot.top + plotHeight * t);
</script>

<div class="card" style="margin-bottom:12px;">
  <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:end;">
    <div>
      <div style="font-size:1.5rem; font-weight:700;">
        {data.player.player_name_primary}
        {#if data.player.player_name_secondary}
          <span class="muted" style="font-size: 1.15rem; margin-left:6px;">({data.player.player_name_secondary})</span>
        {/if}
      </div>
      <div class="muted">Player profile</div>
    </div>

    <div style="display:flex; gap:10px; align-items:end; flex-wrap:wrap;">
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

      {#if data.canEditDisplay}
        <button
          class="btn"
          type="button"
          aria-expanded={profileSettingsOpen}
          aria-controls="player-profile-settings-card"
          aria-label={profileSettingsOpen ? 'Hide profile settings' : 'Show profile settings'}
          title={profileSettingsOpen ? 'Hide profile settings' : 'Show profile settings'}
          on:click={() => (profileSettingsOpen = !profileSettingsOpen)}
        >
          ⚙
        </button>
      {/if}
    </div>
  </div>
</div>

{#if form?.message}
  <div class="card alert" class:alert-success={form.ok !== false} class:alert-error={form.ok === false}>
    {form.message}
  </div>
{/if}

{#if data.canEditDisplay && profileSettingsOpen}
  <div id="player-profile-settings-card" class="card" style="margin-bottom:12px;">
    <div style="font-size:1.05rem; font-weight:650;">Name & display settings</div>
    <div class="muted">Update names and choose what appears publicly for your player profile.</div>

    <form method="POST" action="?/updateDisplay" style="display:flex; gap:10px; flex-wrap:wrap; align-items:end; margin-top:12px;">
      <label style="min-width:220px;">
        <div class="muted">Nickname</div>
        <input name="display_name" bind:value={display_name} placeholder="Optional nickname" />
      </label>
      <label style="min-width:220px;">
        <div class="muted">First name</div>
        <input name="real_first_name" bind:value={real_first_name} placeholder="Optional first name" />
      </label>
      <label style="min-width:220px;">
        <div class="muted">Last name</div>
        <input name="real_last_name" bind:value={real_last_name} placeholder="Optional last name" />
      </label>

      <label style="display:flex; gap:8px; align-items:center; padding:8px 0;">
        <input name="show_display_name" type="checkbox" bind:checked={show_display_name} />
        <span class="muted">Show nick</span>
      </label>
      <label style="display:flex; gap:8px; align-items:center; padding:8px 0;">
        <input name="show_real_first_name" type="checkbox" bind:checked={show_real_first_name} />
        <span class="muted">Show first</span>
      </label>
      <label style="display:flex; gap:8px; align-items:center; padding:8px 0;">
        <input name="show_real_last_name" type="checkbox" bind:checked={show_real_last_name} />
        <span class="muted">Show last</span>
      </label>

      <button class="btn primary" type="submit">Save profile settings</button>
    </form>
  </div>
{/if}

{#if !data.seasonId}
  <div class="card">No active season found.</div>
{:else}
  <div class="card" style="margin-bottom:12px;">
    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:10px;">
      <div class="card" style="border-radius:14px;">
        <div class="muted">Current Rating (R)</div>
        <div style="font-size:2rem; font-weight:750; line-height:1.1; margin-top:4px;">
          {fmtFixed2(data.currentRating?.rate)}
        </div>
      </div>
      <div class="card" style="border-radius:14px;">
        <div class="muted">R Rank</div>
        <div style="font-size:2rem; font-weight:800; line-height:1.1; margin-top:4px;">
          {#if data.currentRatingRank == null}
            -
          {:else}
            #{data.currentRatingRank}
          {/if}
        </div>
        {#if data.currentRatingRankTotal}
          <div class="muted" style="margin-top:2px;">of {data.currentRatingRankTotal}</div>
        {/if}
      </div>
    </div>
    <div class="muted" style="margin-top:8px;">
      Lifetime games: {data.currentRating?.games_played ?? 0}
    </div>
  </div>

  <div class="grid2" style="margin-bottom:12px;">
    <div class="card">
      <div style="font-size:1.05rem; font-weight:650;">Season snapshot</div>

      <div style="display:grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap:10px; margin-top:12px;">
        <div class="card" style="border-radius:14px;">
          <div class="muted">Rank</div>
          {#if data.seasonEligibleRank == null}
            <div class="muted" style="margin-top:6px;">(need more games)</div>
          {:else}
            <div style="font-size:1.3rem; font-weight:700;">{data.seasonEligibleRank}</div>
          {/if}
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
      <div style="font-size:1.05rem; font-weight:650;">Best / worst games</div>

      <div style="margin-top:10px;">
        <div style="display:flex; justify-content:space-between; gap:10px; align-items:center; padding:8px 0; border-top:1px solid var(--table-border);">
          <div>
            <div class="muted">Best</div>
            <div class="muted">{data.bestRawMatch?.played_at ? fmtDateTime(data.bestRawMatch.played_at) : ''}</div>
          </div>
          <div style="display:flex; align-items:center; gap:10px;">
            <div style="font-weight:700;">{data.bestRawMatch?.raw_points ?? '-'}</div>
            {#if data.bestRawMatch?.match_id}
              <a class="btn" href={`/match/${data.bestRawMatch.match_id}`} style="text-decoration:none;">View</a>
            {/if}
          </div>
        </div>
        <div style="display:flex; justify-content:space-between; gap:10px; align-items:center; padding:8px 0; border-top:1px solid var(--table-border);">
          <div>
            <div class="muted">Worst</div>
            <div class="muted">{data.worstRawMatch?.played_at ? fmtDateTime(data.worstRawMatch.played_at) : ''}</div>
          </div>
          <div style="display:flex; align-items:center; gap:10px;">
            <div style="font-weight:700;">{data.worstRawMatch?.raw_points ?? '-'}</div>
            {#if data.worstRawMatch?.match_id}
              <a class="btn" href={`/match/${data.worstRawMatch.match_id}`} style="text-decoration:none;">View</a>
            {/if}
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="card" style="margin-bottom:12px;">
    <div style="font-size:1.05rem; font-weight:650;">Match History</div>

    <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; align-items:center; margin-top:12px;">
      <div style="display:flex; gap:6px; flex-wrap:wrap;">
        {#each historyRangeOptions as opt}
          <button class="btn" class:primary={historyRange === opt.key} type="button" on:click={() => (historyRange = opt.key)}>
            {opt.label}
          </button>
        {/each}
      </div>

      <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
          <span class="muted" style="display:inline-flex; align-items:center; gap:6px; font-size:1.1rem;">
            <span style="width:10px; height:10px; border-radius:999px; background:#3b82f6; display:inline-block;"></span>
            SP (left axis)
          </span>
        <span class="muted" style="display:inline-flex; align-items:center; gap:6px; font-size:1.1rem;">
            <span style="width:10px; height:10px; border-radius:999px; background:#f59e0b; display:inline-block;"></span>
            R (right axis)
          </span>
      </div>
    </div>

    <div style="margin-top:12px;">
      {#if hasHistoryData}
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} style="width:100%; height:auto; display:block;">
          <rect
            x={plot.left}
            y={plot.top}
            width={plotWidth}
            height={plotHeight}
            fill="none"
            stroke="var(--table-border)"
            stroke-width="1"
          />

          {#each yGridYs as y}
            <line
              x1={plot.left}
              y1={y}
              x2={plot.left + plotWidth}
              y2={y}
              stroke="var(--table-border)"
              stroke-opacity="0.45"
              stroke-dasharray="3 3"
            />
          {/each}

          {#each xAxisTicks as tick}
            <line
              x1={xAtIndex(tick.idx, xGameTicks.length)}
              y1={plot.top}
              x2={xAtIndex(tick.idx, xGameTicks.length)}
              y2={plot.top + plotHeight}
              stroke="var(--table-border)"
              stroke-opacity="0.35"
              stroke-dasharray="3 3"
            />
            <text
              x={xAtIndex(tick.idx, xGameTicks.length)}
              y={plot.top + plotHeight + 16}
              text-anchor="middle"
              dominant-baseline="hanging"
              font-size="16"
              font-weight="650"
              fill="var(--muted)"
            >
              {tick.idx + 1}
            </text>
          {/each}

          {#if spPoints.length > 1}
            <path d={spPath} fill="none" stroke="#3b82f6" stroke-width="2.4" />
          {/if}
          {#if rPoints.length > 1}
            <path d={rPath} fill="none" stroke="#f59e0b" stroke-width="2.4" />
          {/if}

          {#each spPoints as p}
            <a href={`/match/${p.row.match_id}`}>
              <circle cx={p.x} cy={p.y} r="4" fill="#3b82f6" stroke="var(--card-bg)" stroke-width="1.5">
                <title>{spPointTooltip(p.row)}</title>
              </circle>
            </a>
          {/each}

          {#each rPoints as p}
            <a href={`/match/${p.row.match_id}`}>
              <circle cx={p.x} cy={p.y} r="4" fill="#f59e0b" stroke="var(--card-bg)" stroke-width="1.5">
                <title>{rPointTooltip(p.row)}</title>
              </circle>
            </a>
          {/each}

          <text
            x={plot.left - 8}
            y={plot.top + 10}
            text-anchor="end"
            font-size="15"
            font-weight="700"
            fill="#3b82f6"
          >
            {fmtNum(spRange[1], 0)}
          </text>
          <text
            x={plot.left - 8}
            y={plot.top + plotHeight}
            text-anchor="end"
            dominant-baseline="ideographic"
            font-size="15"
            font-weight="700"
            fill="#3b82f6"
          >
            {fmtNum(spRange[0], 0)}
          </text>

          <text
            x={plot.left + plotWidth + 8}
            y={plot.top + 10}
            text-anchor="start"
            font-size="15"
            font-weight="700"
            fill="#f59e0b"
          >
            {fmtNum(rRange[1], 0)}
          </text>
          <text
            x={plot.left + plotWidth + 8}
            y={plot.top + plotHeight}
            text-anchor="start"
            dominant-baseline="ideographic"
            font-size="15"
            font-weight="700"
            fill="#f59e0b"
          >
            {fmtNum(rRange[0], 0)}
          </text>
        </svg>
      {:else}
        <div class="muted">No SP or Rating history yet.</div>
      {/if}
    </div>
  </div>

  <div class="card">
      <div style="font-size:1.05rem; font-weight:650;">Recent matches</div>
      <div class="muted">Last 100 matches (most recent first).</div>

      <div style="margin-top:12px; height:520px; overflow-y:auto; overflow-x:auto;">
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
{/if}
