<script lang="ts">
  import { clickableRow } from '$lib/clickable-row';
  import { fmtDateTime, fmtNum, fmtPct, fmtFixed, fmtSigned, signTone } from '$lib/ui';
  import { ordinal, windKanji, windName } from '$lib/mahjong';
  import { PLAYER_PROFILE_MEDIA_URL_MAX_CHARS, PLAYER_PROFILE_MESSAGE_MAX_CHARS } from '$lib/player-profile-content';
  import { placementChartY } from '$lib/placement-chart';
  export let data: any;
  export let form: any;

  let season = data.seasonId;
  let eventId = data.eventId ?? '';
  let display_name = data.player.display_name ?? '';
  let real_first_name = data.player.real_first_name ?? '';
  let real_last_name = data.player.real_last_name ?? '';
  let show_display_name = data.player.show_display_name ?? true;
  let show_real_first_name = data.player.show_real_first_name ?? false;
  let show_real_last_name = data.player.show_real_last_name ?? false;
  let profile_message_md = data.player.profile_message_md ?? '';
  let profile_media_url = data.player.profile_media_url ?? '';
  let profileSettingsOpen = false;

  $: season = data.seasonId;
  $: eventId = data.eventId ?? '';

  $: if (data.canEditDisplay && form?.message) {
    profileSettingsOpen = true;
  }

  function submitSelect(event: Event) {
    const select = event.currentTarget as HTMLSelectElement;
    select.form?.requestSubmit();
  }

  type HistoryRange = '10' | '20' | '50' | 'all';
  type HistoryView = 'score' | 'placement';
  type ChartPoint = { row: any; x: number; y: number };

  const historyRangeOptions: { key: HistoryRange; label: string }[] = [
    { key: '10', label: 'Last 10' },
    { key: '20', label: 'Last 20' },
    { key: '50', label: 'Last 50' },
    { key: 'all', label: 'All time' }
  ];

  let historyRange: HistoryRange = '10';
  let historyView: HistoryView = 'score';
  const chartWidth = 1280;
  const chartHeight = 500;
  const plot = { left: 64, right: 64, top: 18, bottom: 92 };

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
    let min = values[0];
    let max = values[0];
    for (const value of values) {
      if (value < min) min = value;
      if (value > max) max = value;
    }
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
    const pointsDelta = row?.points_with_adjustments ?? row?.club_points;
    return `${label}${date ? ` • ${date}` : ''}\nSP Δ ${fmtNum(pointsDelta, 2)} | Cum SP ${fmtNum(row?.cumulative_points, 2)}`;
  }

  function rPointTooltip(row: any) {
    const label = String(row?.match_label ?? String(row?.match_id ?? '').slice(0, 8));
    const date = row?.played_at ? fmtDateTime(row.played_at) : '';
    return `${label}${date ? ` • ${date}` : ''}\nPlace ${row?.placement ?? '-'} | ΔR ${fmtNum(row?.delta, 2)} | R ${fmtNum(row?.new_rate, 2)}`;
  }

  function placementPointTooltip(row: any) {
    const label = String(row?.match_label ?? String(row?.match_id ?? '').slice(0, 8));
    const date = row?.played_at ? fmtDateTime(row.played_at) : '';
    return `${label}${date ? ` • ${date}` : ''}\nPlacement ${row?.placement ?? '-'}`;
  }

  $: showPlacementHistory = data.isCasualSeason || historyView === 'placement';
  $: spRows = showPlacementHistory ? [] : historySlice(data.pointHistory ?? [], historyRange);
  $: rRows = showPlacementHistory ? [] : historySlice(data.ratingHistory ?? [], historyRange);
  $: placementRows = showPlacementHistory ? historySlice(data.placementHistory ?? [], historyRange) : [];
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

  function yPlacement(value: number) {
    return placementChartY(value, plot.top, plotHeight) ?? plot.top;
  }

  $: chartRows = showPlacementHistory ? placementRows : [...spRows, ...rRows];

  $: xGameTicks = (() => {
    const byMatch = new Map<string, { key: string; ts: number; label: string }>();
    for (const row of chartRows) {
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

  $: placementPoints = placementRows
    .map((row: any) => {
      const value = Number(row?.placement);
      if (!Number.isInteger(value) || value < 1 || value > 4) return null;
      const x = xByGameKey.get(rowGameKey(row));
      if (x == null) return null;
      return { row, x, y: yPlacement(value) };
    })
    .filter((p: ChartPoint | null): p is ChartPoint => p !== null);

  $: spPath = pathFrom(spPoints);
  $: rPath = pathFrom(rPoints);
  $: placementPath = pathFrom(placementPoints);
  $: hasHistoryData = showPlacementHistory
    ? placementPoints.length > 0
    : spPoints.length > 0 || rPoints.length > 0;
  $: yGridYs = [0, 0.25, 0.5, 0.75, 1].map((t) => plot.top + plotHeight * t);
  $: placementAxisTicks = [1, 2, 3, 4].map((placement) => ({ placement, y: yPlacement(placement) }));

  $: placementCounts = [
    { place: 1, count: Number(data.stats?.firsts ?? 0) },
    { place: 2, count: Number(data.stats?.seconds ?? 0) },
    { place: 3, count: Number(data.stats?.thirds ?? 0) },
    { place: 4, count: Number(data.stats?.fourths ?? 0) }
  ];
  $: placementTotal = placementCounts.reduce((sum, item) => sum + (Number.isFinite(item.count) ? item.count : 0), 0);
  $: seasonSp = data.standingsRow?.total_points_with_adjustments ?? data.stats?.total_points;
  $: seasonSpTone = signTone(seasonSp);
</script>

<div class="card" style="margin-bottom:12px;">
  <div class="card-head">
    <div>
      <div class="title-row">
        <span class="led-tag" lang="ja" aria-hidden="true">雀士</span>
        <h1 class="page-title title-plain">
          {data.player.player_name_primary}
          {#if data.player.player_name_secondary}
            <span class="muted" style="font-size: 1rem; margin-left:6px; font-weight:500;">({data.player.player_name_secondary})</span>
          {/if}
        </h1>
      </div>
      <div class="muted">Player profile</div>
    </div>

    <div class="profile-controls">
      <form method="GET" class="profile-filter">
        <label>
          <span class="muted">Season</span>
          <select name="season" bind:value={season} style="min-width:240px;" on:change={submitSelect}>
            {#each data.seasons as s}
              <option value={s.id}>{s.name}</option>
            {/each}
          </select>
        </label>
      </form>

      {#if data.isCasualSeason}
        <form method="GET" class="profile-filter">
          <input type="hidden" name="season" value={data.seasonId} />
          <label>
            <span class="muted">Event</span>
            <select name="event" bind:value={eventId} style="min-width:200px;" on:change={submitSelect}>
              <option value="">All events</option>
              {#each data.events ?? [] as event}
                <option value={event.id}>{event.name}</option>
              {/each}
            </select>
          </label>
        </form>
      {/if}

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

{#if data.profileMessageHtml}
  <div class="card" style="margin-bottom:12px;">
    <h2 class="card-title">Player message</h2>

    {#if data.profileMedia}
      <div class="profile-media">
        {#if data.profileMedia.kind === 'image'}
          <img
            class="profile-media-image"
            src={data.profileMedia.url}
            alt={`${data.player.player_name_primary} media`}
            loading="lazy"
          />
        {:else if data.profileMedia.kind === 'video'}
          <div class="profile-media-frame">
            <!-- svelte-ignore a11y_media_has_caption -->
            <video src={data.profileMedia.url} controls preload="metadata" playsinline></video>
          </div>
        {:else if data.profileMedia.kind === 'youtube'}
          <div class="profile-media-frame">
            <iframe
              src={data.profileMedia.embed_url}
              title={`${data.player.player_name_primary} video`}
              loading="lazy"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerpolicy="strict-origin-when-cross-origin"
              allowfullscreen
            ></iframe>
          </div>
        {/if}
      </div>
    {/if}

    <div class="profile-rich">{@html data.profileMessageHtml}</div>
  </div>
{/if}

<style>
  .profile-controls {
    display: flex;
    gap: 10px;
    align-items: flex-end;
    flex-wrap: wrap;
  }

  .profile-filter {
    display: flex;
    align-items: flex-end;
    min-width: 0;
  }

  .profile-filter label {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  .profile-filter select {
    max-width: 100%;
  }

  .stat-grid {
    display: grid;
    gap: 10px;
  }

  .stat-grid--r {
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  }

  .stat-grid--season {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    margin-top: 12px;
  }

  .stat-grid .led {
    justify-self: start;
  }

  .stat-list {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px 14px;
    margin: 12px 0 0;
  }

  .stat-list div {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 0;
    border-bottom: 1px solid var(--table-row);
  }

  .stat-list dt {
    color: var(--muted);
    font-size: 0.88rem;
  }

  .stat-list dd {
    margin: 0;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .place-split {
    margin-top: 14px;
  }

  .place-bar {
    display: flex;
    height: 10px;
    margin-top: 8px;
    overflow: hidden;
    border-radius: 999px;
    background: var(--screen);
    box-shadow: inset 0 0 0 1px var(--screen-line);
  }

  .place-bar span {
    min-width: 0;
  }

  .p1 { background: var(--led-teal); }
  .p2 { background: var(--led-green); }
  .p3 { background: var(--led-amber); }
  .p4 { background: var(--led-red); }

  .place-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    margin: 8px 0 0;
    padding: 0;
    list-style: none;
    font-size: 0.85rem;
  }

  .place-legend li {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .place-legend .swatch {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .game-line {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    align-items: center;
    padding: 10px 0;
    border-top: 1px solid var(--table-row);
  }

  .game-line:first-child {
    border-top: 0;
  }

  .game-line__score {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .history-toolbar {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
    align-items: center;
    margin-top: 12px;
  }

  .history-legend {
    display: flex;
    gap: 14px;
    align-items: center;
    flex-wrap: wrap;
  }

  .legend-item {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    color: var(--muted);
    font-size: 0.85rem;
    letter-spacing: 0.04em;
  }

  .legend-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
  }

  .legend-dot.is-sp { background: var(--led-teal); box-shadow: 0 0 6px var(--led-teal); }
  .legend-dot.is-r { background: var(--led-amber); box-shadow: 0 0 6px var(--led-amber); }
  .legend-dot.is-place { background: var(--led-green); box-shadow: 0 0 6px var(--led-green); }

  .history-chart {
    margin-top: 12px;
    padding: 6px;
  }

  .history-chart svg {
    display: block;
    width: 100%;
    height: auto;
  }

  .history-chart text {
    font-family: var(--font-led);
  }

  .history-chart .line-sp { filter: drop-shadow(0 0 4px var(--glow-teal)); }
  .history-chart .line-r { filter: drop-shadow(0 0 4px var(--glow-amber)); }
  .history-chart .line-place { filter: drop-shadow(0 0 4px var(--glow-green)); }

  @media (max-width: 560px) {
    .stat-grid--season,
    .stat-list {
      grid-template-columns: minmax(0, 1fr);
    }

    .profile-filter select {
      min-width: 0 !important;
    }
  }

  .profile-media {
    margin-top: 10px;
    margin-bottom: 12px;
  }

  .profile-media-image {
    display: block;
    width: 100%;
    max-height: 520px;
    object-fit: contain;
    border-radius: 14px;
    border: 1px solid var(--table-border);
    background: color-mix(in oklab, var(--card-bg) 80%, black 20%);
  }

  .profile-media-frame {
    width: 100%;
    border-radius: 14px;
    border: 1px solid var(--table-border);
    overflow: hidden;
    background: #000;
    aspect-ratio: 16 / 9;
  }

  .profile-media-frame :global(video),
  .profile-media-frame :global(iframe) {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
  }

  .profile-rich {
    line-height: 1.55;
    word-break: break-word;
  }

  .profile-rich :global(h1),
  .profile-rich :global(h2),
  .profile-rich :global(h3) {
    margin: 0.35rem 0 0.5rem;
    line-height: 1.2;
  }

  .profile-rich :global(p) {
    margin: 0 0 0.65rem;
  }

  .profile-rich :global(p:last-child) {
    margin-bottom: 0;
  }

  .profile-rich :global(ul) {
    margin: 0 0 0.65rem;
    padding-left: 1.25rem;
  }

  .profile-rich :global(li) {
    margin: 0.2rem 0;
  }

  .profile-rich :global(code) {
    padding: 0.05rem 0.35rem;
    border-radius: 6px;
    background: color-mix(in oklab, var(--table-border) 35%, var(--card-bg) 65%);
    font-size: 0.95em;
  }
</style>

{#if data.canEditDisplay && profileSettingsOpen}
  <div id="player-profile-settings-card" class="card" style="margin-bottom:12px;">
    <h2 class="card-title">Profile & display settings</h2>
    <div class="muted" style="margin-top:4px;">Update names, public display options, and your custom player message.</div>

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

      <label style="flex:1 1 100%;">
        <div class="muted">Custom message (Markdown)</div>
        <textarea
          name="profile_message_md"
          bind:value={profile_message_md}
          rows="6"
          style="width: 90%"
          maxlength={PLAYER_PROFILE_MESSAGE_MAX_CHARS}
          placeholder="Share a short intro, links, accomplishments, or anything you want on your player page."
        ></textarea>
      </label>

      <label style="flex:1 1 100%;">
        <div class="muted">Image / video URL (optional)</div>
        <input
          name="profile_media_url"
          bind:value={profile_media_url}
          style="width: 90%"
          maxlength={PLAYER_PROFILE_MEDIA_URL_MAX_CHARS}
          placeholder="https://... (direct image/video link or YouTube URL)"
        />
      </label>

      <div class="muted" style="flex:1 1 100%; font-size:0.95rem;">
        Media is only shown when a custom message is set
      </div>

      <button class="btn primary" type="submit">Save profile settings</button>
    </form>
  </div>
{/if}

{#if !data.seasonId}
  <div class="card">No active season found.</div>
{:else}
  {#if !data.isCasualSeason}
    <div class="card" style="margin-bottom:12px;">
      <div class="stat-grid stat-grid--r">
        <div class="stat-tile">
          <div class="stat-label">Current Rating (R)</div>
          <span class="led led-lg led-amber">{fmtFixed(data.currentRating?.rate)}</span>
        </div>
        <div class="stat-tile">
          <div class="stat-label">R Rank</div>
          <span class="led led-lg led-teal">
            {#if data.currentRatingRank == null}
              -
            {:else}
              #{data.currentRatingRank}
            {/if}
          </span>
          {#if data.currentRatingRankTotal}
            <div class="muted">of {data.currentRatingRankTotal}</div>
          {/if}
        </div>
      </div>
      <div class="muted" style="margin-top:10px;">
        Lifetime games: {data.currentRating?.games_played ?? 0}
      </div>
    </div>
  {/if}

  <div class="grid2" style="margin-bottom:12px;">
    <div class="card">
      <div class="title-row">
        <span class="led-tag" lang="ja" aria-hidden="true">成績</span>
        <h2 class="card-title">{data.isCasualSeason ? 'Casual snapshot' : 'Season snapshot'}</h2>
      </div>

      <div class="stat-grid stat-grid--season">
        <div class="stat-tile">
          <div class="stat-label">Rank</div>
          {#if data.seasonEligibleRank == null}
            <div class="muted">
              {data.isCasualSeason ? '(no games)' : '(need more games)'}
            </div>
          {:else}
            <span class="led led-md" class:led-amber={data.seasonEligibleRank === 1} class:led-teal={data.seasonEligibleRank === 2 || data.seasonEligibleRank === 3}>{data.seasonEligibleRank}</span>
          {/if}
        </div>
        <div class="stat-tile">
          <div class="stat-label">Season Points (SP)</div>
          <span class="led led-md" class:led-pos={seasonSpTone === 'pos'} class:led-neg={seasonSpTone === 'neg'}>{fmtSigned(seasonSp, 2)}</span>
        </div>
        <div class="stat-tile">
          <div class="stat-label">Games</div>
          <span class="led led-md">{data.stats?.games_played ?? 0}</span>
        </div>
      </div>

      <dl class="stat-list">
        <div><dt>Avg placement</dt><dd>{fmtFixed(data.stats?.avg_placement)}</dd></div>
        <div><dt>Avg SP</dt><dd>{fmtSigned(data.stats?.avg_points, 2)}</dd></div>
        <div><dt>Top2% (rentai)</dt><dd>{fmtPct(data.stats?.top2_rate)}</dd></div>
      </dl>

      <div class="place-split">
        <div class="stat-label">Placement split</div>
        <div class="place-bar" role="img" aria-label={`1st ${placementCounts[0].count}, 2nd ${placementCounts[1].count}, 3rd ${placementCounts[2].count}, 4th ${placementCounts[3].count}`}>
          {#if placementTotal > 0}
            {#each placementCounts as item}
              <span class={`p${item.place}`} style={`width:${(item.count / placementTotal) * 100}%`}></span>
            {/each}
          {/if}
        </div>
        <ul class="place-legend">
          {#each placementCounts as item}
            <li><span class={`swatch p${item.place}`}></span>{ordinal(item.place)} <strong>{item.count}</strong></li>
          {/each}
        </ul>
      </div>
    </div>

    <div class="card">
      <div class="title-row">
        <span class="led-tag" lang="ja" aria-hidden="true">記録</span>
        <h2 class="card-title">Best / worst games</h2>
      </div>

      <div style="margin-top:10px;">
        <div class="game-line">
          <div>
            <div class="stat-label">Best</div>
            <div class="muted">{data.bestRawMatch?.played_at ? fmtDateTime(data.bestRawMatch.played_at) : ''}</div>
          </div>
          <div class="game-line__score">
            {#if data.bestRawMatch?.raw_points == null}
              <span class="muted">-</span>
            {:else}
              <span class="led led-red">{fmtNum(data.bestRawMatch.raw_points, 0)}</span>
            {/if}
            {#if data.bestRawMatch?.match_id}
              <a class="btn" href={`/match/${data.bestRawMatch.match_id}`}>View</a>
            {/if}
          </div>
        </div>
        <div class="game-line">
          <div>
            <div class="stat-label">Worst</div>
            <div class="muted">{data.worstRawMatch?.played_at ? fmtDateTime(data.worstRawMatch.played_at) : ''}</div>
          </div>
          <div class="game-line__score">
            {#if data.worstRawMatch?.raw_points == null}
              <span class="muted">-</span>
            {:else}
              <span class="led led-red">{fmtNum(data.worstRawMatch.raw_points, 0)}</span>
            {/if}
            {#if data.worstRawMatch?.match_id}
              <a class="btn" href={`/match/${data.worstRawMatch.match_id}`}>View</a>
            {/if}
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="card" style="margin-bottom:12px;">
    <div class="title-row">
      <span class="led-tag" lang="ja" aria-hidden="true">推移</span>
      <h2 class="card-title">Match history</h2>
    </div>

    <div class="history-toolbar">
      <div class="seg" role="group" aria-label="History range">
        {#each historyRangeOptions as opt}
          <button
            type="button"
            aria-pressed={historyRange === opt.key}
            on:click={() => (historyRange = opt.key)}
          >
            {opt.label}
          </button>
        {/each}
      </div>

      <div class="history-legend">
        {#if !data.isCasualSeason}
          <div class="seg" role="group" aria-label="History display">
            <button
              type="button"
              aria-pressed={historyView === 'score'}
              on:click={() => (historyView = 'score')}
            >
              SP / R
            </button>
            <button
              type="button"
              aria-pressed={historyView === 'placement'}
              on:click={() => (historyView = 'placement')}
            >
              Placement
            </button>
          </div>
        {/if}

        {#if showPlacementHistory}
          <span class="legend-item"><span class="legend-dot is-place"></span>Placement (1st at top)</span>
        {:else}
          <span class="legend-item"><span class="legend-dot is-sp"></span>SP (left axis)</span>
          <span class="legend-item"><span class="legend-dot is-r"></span>R (right axis)</span>
        {/if}
      </div>
    </div>

    <div>
      {#if hasHistoryData}
        <div class="history-chart screen-panel">
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`}>
          <rect
            x={plot.left}
            y={plot.top}
            width={plotWidth}
            height={plotHeight}
            fill="none"
            stroke="var(--screen-line)"
            stroke-width="1"
          />

          {#if showPlacementHistory}
            {#each placementAxisTicks as tick}
              <line
                x1={plot.left}
                y1={tick.y}
                x2={plot.left + plotWidth}
                y2={tick.y}
                stroke="var(--led-dim)"
                stroke-opacity="0.45"
                stroke-dasharray="3 3"
              />
              <text
                x={plot.left - 8}
                y={tick.y}
                text-anchor="end"
                dominant-baseline="middle"
                font-size="15"
                font-weight="700"
                fill="var(--led-green)"
              >
                {tick.placement}
              </text>
            {/each}
          {:else}
            {#each yGridYs as y}
              <line
                x1={plot.left}
                y1={y}
                x2={plot.left + plotWidth}
                y2={y}
                stroke="var(--led-dim)"
                stroke-opacity="0.45"
                stroke-dasharray="3 3"
              />
            {/each}
          {/if}

          {#each xAxisTicks as tick}
            <line
              x1={xAtIndex(tick.idx, xGameTicks.length)}
              y1={plot.top}
              x2={xAtIndex(tick.idx, xGameTicks.length)}
              y2={plot.top + plotHeight}
              stroke="var(--led-dim)"
              stroke-opacity="0.35"
              stroke-dasharray="3 3"
            />
            <text
              x={xAtIndex(tick.idx, xGameTicks.length)}
              y={plot.top + plotHeight + 16}
              text-anchor="middle"
              dominant-baseline="hanging"
              font-size="16"
              fill="var(--led-mid)"
            >
              {tick.idx + 1}
            </text>
          {/each}

          {#if showPlacementHistory}
            {#if placementPoints.length > 1}
              <path class="line-place" d={placementPath} fill="none" stroke="var(--led-green)" stroke-width="2.4" />
            {/if}

            {#each placementPoints as p}
              <a href={`/match/${p.row.match_id}`}>
                <circle cx={p.x} cy={p.y} r="4" fill="var(--led-green)" stroke="var(--screen)" stroke-width="1.5">
                  <title>{placementPointTooltip(p.row)}</title>
                </circle>
              </a>
            {/each}
          {:else}
            {#if spPoints.length > 1}
              <path class="line-sp" d={spPath} fill="none" stroke="var(--led-teal)" stroke-width="2.4" />
            {/if}
            {#if rPoints.length > 1}
              <path class="line-r" d={rPath} fill="none" stroke="var(--led-amber)" stroke-width="2.4" />
            {/if}

            {#each spPoints as p}
              <a href={`/match/${p.row.match_id}`}>
                <circle cx={p.x} cy={p.y} r="4" fill="var(--led-teal)" stroke="var(--screen)" stroke-width="1.5">
                  <title>{spPointTooltip(p.row)}</title>
                </circle>
              </a>
            {/each}

            {#each rPoints as p}
              <a href={`/match/${p.row.match_id}`}>
                <circle cx={p.x} cy={p.y} r="4" fill="var(--led-amber)" stroke="var(--screen)" stroke-width="1.5">
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
              fill="var(--led-teal)"
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
              fill="var(--led-teal)"
            >
              {fmtNum(spRange[0], 0)}
            </text>

            <text
              x={plot.left + plotWidth + 8}
              y={plot.top + 10}
              text-anchor="start"
              font-size="15"
              font-weight="700"
              fill="var(--led-amber)"
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
              fill="var(--led-amber)"
            >
              {fmtNum(rRange[0], 0)}
            </text>
          {/if}
        </svg>
        </div>
      {:else}
        <div class="muted" style="margin-top:12px;">
          {showPlacementHistory ? 'No placement history yet.' : 'No SP or Rating history yet.'}
        </div>
      {/if}
    </div>
  </div>

  <div class="card">
      <div class="title-row">
        <span class="led-tag" lang="ja" aria-hidden="true">対局</span>
        <h2 class="card-title">Recent matches</h2>
      </div>
      <div class="muted" style="margin-top:4px;">Last 100 matches (most recent first).</div>

      <div style="margin-top:12px; max-height:520px; overflow-y:auto; overflow-x:auto;">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Match</th>
              <th style="width:80px;">Seat</th>
              <th style="width:80px;">Place</th>
              <th class="num" style="width:110px;">SP Δ</th>
            </tr>
          </thead>
          <tbody>
            {#each data.matchHistory as r}
              {@const spTone = signTone(r.club_points)}
              <tr use:clickableRow={`/match/${r.match_id}`}>
                <td>{fmtDateTime(r.played_at)}</td>
                <td><a href={`/match/${r.match_id}`} style="text-decoration:none;">{r.match_label}</a></td>
                <td>
                  <span class="wind-cell">
                    <span class="wind" class:is-lit={r.seat === 'E'} lang="ja" aria-hidden="true">{windKanji(r.seat)}</span>
                    <span class="wind-letter"><span class="sr-only">{windName(r.seat)}</span><span aria-hidden="true">{r.seat}</span></span>
                  </span>
                </td>
                <td><span class="place-chip" data-place={r.placement}>{ordinal(r.placement)}</span></td>
                <td class="num" class:pos={spTone === 'pos'} class:neg={spTone === 'neg'}>{fmtSigned(r.club_points, 2)}</td>
              </tr>
            {/each}
            {#if data.matchHistory.length === 0}
              <tr><td colspan="5" class="muted">No matches recorded.</td></tr>
            {/if}
          </tbody>
        </table>
      </div>
  </div>
{/if}
