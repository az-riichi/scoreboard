<script lang="ts">
  import { clickableRow } from '$lib/clickable-row';
  import DateText from '$lib/DateText.svelte';
  import MatchHistoryChart from '$lib/MatchHistoryChart.svelte';
  import { fmtNum, fmtPct, fmtFixed, fmtSigned, signTone } from '$lib/ui';
  import { ordinal, windKanji, windName } from '$lib/mahjong';
  import { PLAYER_PROFILE_MEDIA_URL_MAX_CHARS, PLAYER_PROFILE_MESSAGE_MAX_CHARS } from '$lib/player-profile-content';
  import { BIG_WIN_MIN_POINTS, isBigWin } from '$lib/placement-chart';
  import { LIFETIME_SEASON_ID } from '$lib/public-data/derive';
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

  const historyRangeOptions: { key: HistoryRange; label: string }[] = [
    { key: '10', label: 'Last 10' },
    { key: '20', label: 'Last 20' },
    { key: '50', label: 'Last 50' },
    { key: 'all', label: 'All' }
  ];

  let historyRange: HistoryRange = '20';
  let historyView: HistoryView = 'placement';
  let seasonOnly = false;

  function latestGames(rows: any[], range: HistoryRange) {
    return range === 'all' ? rows : rows.slice(-Number(range));
  }

  $: showPlacementHistory = data.isCasualSeason || historyView === 'placement';
  $: isSeasonScope = data.isCasualSeason || seasonOnly;
  $: history = isSeasonScope ? data : data.competitionHistory;
  $: placementRows = latestGames(history.placementHistory, historyRange);
  $: pointRows = latestGames(history.pointHistory, historyRange);
  // This list runs newest first, unlike the chart's rows.
  $: tableRows = historyRange === 'all' ? history.matchHistory : history.matchHistory.slice(0, Number(historyRange));
  $: hasBigWin = showPlacementHistory && placementRows.some((row: any) => isBigWin(row.placement, row.raw_points));
  $: selectedSeason = data.seasons.find((s: any) => s.id === data.seasonId);
  $: seasonNames = new Map<string, string>(data.seasons.map((s: any) => [s.id, s.name]));
  $: ratingByMatch = new Map<string, any>(history.ratingHistory.map((row: any) => [row.match_id, row]));
  // Column shown only when the rows can come from more than one season.
  $: showSeasonColumn = !isSeasonScope;

  $: placementCounts = [
    { place: 1, count: Number(data.stats?.firsts ?? 0) },
    { place: 2, count: Number(data.stats?.seconds ?? 0) },
    { place: 3, count: Number(data.stats?.thirds ?? 0) },
    { place: 4, count: Number(data.stats?.fourths ?? 0) }
  ];
  $: placementTotal = placementCounts.reduce((sum, item) => sum + (Number.isFinite(item.count) ? item.count : 0), 0);
  $: seasonSp = data.lifetime?.total_points ?? data.standingsRow?.total_points_with_adjustments ?? data.stats?.total_points;
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
            <span class="muted" style="margin-left:6px; font-weight:500;">({data.player.player_name_secondary})</span>
          {/if}
        </h1>
      </div>
    </div>

    <div class="profile-controls">
      <form method="GET" class="profile-filter">
        <label>
          <span class="muted">Season</span>
          <select name="season" bind:value={season} style="min-width:240px;" on:change={submitSelect}>
            <option value={LIFETIME_SEASON_ID}>Lifetime</option>
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

  .season-readouts {
    margin-top: 14px;
  }

  .stat-list {
    display: grid;
    /* Three across when they fit a label and its value, and fewer when they do not. */
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 124px), 1fr));
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
    font-size: var(--type-small);
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
    gap: 2px;
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

  .p1 { background: var(--place-1); }
  .p2 { background: var(--place-2); }
  .p3 { background: var(--place-3); }
  .p4 { background: var(--place-4); }

  .place-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    margin: 8px 0 0;
    padding: 0;
    list-style: none;
    font-size: var(--type-small);
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
    margin-left: auto;
  }

  .legend-item {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    color: var(--muted);
    font-size: var(--type-small);
    letter-spacing: 0.04em;
  }

  .legend-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
  }

  .legend-dot.is-sp { background: var(--led-teal); box-shadow: 0 0 6px var(--glow-teal); }
  .legend-dot.is-r { background: var(--led-amber); box-shadow: 0 0 6px var(--glow-amber); }

  .legend-logo {
    display: block;
    width: 18px;
    height: 18px;
  }

  .history-table {
    margin-top: 12px;
  }

  .history-table td:first-child {
    white-space: nowrap;
  }

  .season-table {
    margin-top: 12px;
  }

  /* The season name takes the spare room; the numbers stay as narrow as they can. */
  .season-table th:first-child {
    width: 100%;
  }

  .season-table th,
  .season-table td:not(:first-child) {
    white-space: nowrap;
  }

  /* The match table adds detail as the screen has room for it. */
  @media (max-width: 900px) {
    .col-season {
      display: none;
    }
  }

  @media (max-width: 760px) {
    .col-rating {
      display: none;
    }

    .history-table .wind-letter {
      display: none;
    }

    .history-table td,
    .history-table th {
      padding-left: 5px;
      padding-right: 5px;
    }
  }

  @media (max-width: 560px) {
    .col-delta-r,
    .col-season-detail {
      display: none;
    }

    /* Share the first row with the view control instead of taking a row alone. */
    .history-toolbar > .seg:first-child {
      order: -2;
    }

    .history-legend {
      order: -1;
    }

    .profile-filter,
    .profile-filter label,
    .profile-filter select {
      width: 100%;
      min-width: 0 !important;
    }

    .profile-controls {
      width: 100%;
    }
  }

  @media (max-width: 480px) {
    .col-seat {
      display: none;
    }
  }

  /* The whole row opens the match, so its label can go on the smallest phones. */
  @media (max-width: 360px) {
    .col-match {
      display: none;
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

      <div class="muted" style="flex:1 1 100%;">
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
      <div class="readouts">
        <div class="readout">
          <div class="stat-label">Rating (R)</div>
          <span class="led led-lg led-amber">{fmtFixed(data.currentRating?.rate)}</span>
        </div>
        <div class="readout">
          <div class="stat-label">R rank</div>
          <div class="readout__line">
            <span class="led led-lg led-teal">{data.currentRatingRank == null ? '—' : `#${data.currentRatingRank}`}</span>
            {#if data.currentRatingRankTotal}
              <span class="muted">of {data.currentRatingRankTotal}</span>
            {/if}
          </div>
        </div>
        <div class="readout">
          <div class="stat-label">Ranked games</div>
          <span class="led led-lg">{data.currentRating?.games_played ?? 0}</span>
        </div>
      </div>
    </div>
  {/if}

  <div class="grid2" style="margin-bottom:12px;">
    <div class="card">
      <div class="title-row">
        <span class="led-tag" lang="ja" aria-hidden="true">成績</span>
        <h2 class="card-title">{data.isLifetime ? 'Lifetime snapshot' : data.isCasualSeason ? 'Casual snapshot' : 'Season snapshot'}</h2>
      </div>

      <div class="readouts season-readouts">
        {#if data.lifetime}
          <div class="readout">
            <div class="stat-label">Seasons</div>
            <span class="led led-md">{data.lifetime.seasons.length}</span>
          </div>
        {:else}
          <div class="readout">
            <div class="stat-label">Rank</div>
            {#if data.seasonEligibleRank == null}
              <span class="led led-md">—</span>
            {:else}
              <span class="led led-md" class:led-amber={data.seasonEligibleRank === 1} class:led-teal={data.seasonEligibleRank === 2 || data.seasonEligibleRank === 3}>{data.seasonEligibleRank}</span>
            {/if}
          </div>
        {/if}
        <div class="readout">
          <div class="stat-label">{data.isLifetime ? 'Total SP' : 'SP'}</div>
          <span class="led led-md" class:led-pos={seasonSpTone === 'pos'} class:led-neg={seasonSpTone === 'neg'}>{fmtSigned(seasonSp, 2)}</span>
        </div>
        <div class="readout">
          <div class="stat-label">Games</div>
          <span class="led led-md">{data.stats?.games_played ?? 0}</span>
        </div>
      </div>

      <dl class="stat-list">
        <div><dt>Avg placement</dt><dd>{fmtFixed(data.stats?.avg_placement)}</dd></div>
        <div><dt>Avg SP</dt><dd>{fmtSigned(data.stats?.avg_points, 2)}</dd></div>
        <div><dt>Top 2%</dt><dd>{fmtPct(data.stats?.top2_rate)}</dd></div>
        {#if data.lifetime}
          <div><dt>Win rate</dt><dd>{fmtPct(data.stats?.first_rate)}</dd></div>
          <div><dt>Last rate</dt><dd>{fmtPct(data.stats?.fourth_rate)}</dd></div>
          <div><dt>Busts</dt><dd>{data.lifetime.busts}</dd></div>
          <div><dt>Best finish</dt><dd>{data.lifetime.best_rank == null ? '—' : ordinal(data.lifetime.best_rank)}</dd></div>
          <div><dt>Titles</dt><dd>{data.lifetime.titles}</dd></div>
          <div><dt>Peak R</dt><dd>{data.lifetime.peak_rating == null ? '—' : fmtNum(data.lifetime.peak_rating, 0)}</dd></div>
        {/if}
      </dl>

      <div class="place-split">
        <div class="stat-label">Placement split</div>
        <div class="place-bar" role="img" aria-label={`1st ${placementCounts[0].count}, 2nd ${placementCounts[1].count}, 3rd ${placementCounts[2].count}, 4th ${placementCounts[3].count}`}>
          {#if placementTotal > 0}
            {#each placementCounts as item}
              {#if item.count > 0}
                <span class={`p${item.place}`} style={`width:${(item.count / placementTotal) * 100}%`}></span>
              {/if}
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
        <span class="led-tag" lang="ja" aria-hidden="true">最高・最低</span>
        <h2 class="card-title">Best / worst games</h2>
      </div>

      <div style="margin-top:10px;">
        <div class="game-line">
          <div>
            <div class="stat-label">Best</div>
            {#if data.bestRawMatch?.played_at}
              <div class="muted"><DateText value={data.bestRawMatch.played_at} keepYear /></div>
            {/if}
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
            {#if data.worstRawMatch?.played_at}
              <div class="muted"><DateText value={data.worstRawMatch.played_at} keepYear /></div>
            {/if}
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

  {#if data.lifetime && data.lifetime.seasons.length > 0}
    <div class="card" style="margin-bottom:12px;">
      <div class="title-row">
        <span class="led-tag" lang="ja" aria-hidden="true">シーズン別</span>
        <h2 class="card-title">Season by season</h2>
      </div>

      <div class="season-table">
        <table>
          <thead>
            <tr>
              <th>Season</th>
              <th>Rank</th>
              <th class="num">Games</th>
              <th class="num">SP</th>
              <th class="num col-season-detail">Avg place</th>
              <th class="num col-season-detail">Top 2%</th>
            </tr>
          </thead>
          <tbody>
            {#each data.lifetime.seasons as s (s.season_id)}
              {@const href = `/player/${data.player.id}?season=${s.season_id}`}
              {@const tone = signTone(s.total_points, 1)}
              <tr use:clickableRow={href}>
                <td>
                  <a {href} style="text-decoration:none;">{s.season_name}</a>
                  {#if s.is_active}
                    <span class="led-dot is-on is-blink" style="margin-left:4px;" role="img" aria-label="In progress"></span>
                  {/if}
                </td>
                <td>
                  {#if s.rank == null}
                    <span class="muted">—</span>
                  {:else}
                    <span class="rank-led" data-rank={s.rank}>{s.rank}</span>
                  {/if}
                </td>
                <td class="num">{s.games_played}</td>
                <td class="num" class:pos={tone === 'pos'} class:neg={tone === 'neg'}>{fmtSigned(s.total_points, 1, true)}</td>
                <td class="num col-season-detail">{fmtFixed(s.avg_placement, 2)}</td>
                <td class="num col-season-detail">{fmtPct(s.top2_rate)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}

  <div class="card">
    <div class="title-row">
      <span class="led-tag" lang="ja" aria-hidden="true">成績推移</span>
      <h2 class="card-title">Match history</h2>
    </div>

    <div class="history-toolbar">
      {#if !data.isCasualSeason}
        <div class="seg" role="group" aria-label="History display">
          <button
            type="button"
            aria-pressed={historyView === 'placement'}
            on:click={() => (historyView = 'placement')}
          >
            Placement
          </button>
          <button
            type="button"
            aria-pressed={historyView === 'score'}
            on:click={() => (historyView = 'score')}
          >
            SP / R
          </button>
        </div>
      {/if}

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

      {#if !data.isCasualSeason && selectedSeason}
        <button
          type="button"
          class="switch"
          role="switch"
          aria-checked={seasonOnly}
          on:click={() => (seasonOnly = !seasonOnly)}
        >
          <span class="switch__track" aria-hidden="true"></span>
          {selectedSeason.is_active ? 'Current season only' : `${selectedSeason.name} only`}
        </button>
      {/if}

      {#if !showPlacementHistory || hasBigWin}
        <div class="history-legend">
          {#if showPlacementHistory}
            <span class="legend-item"><img class="legend-logo" src="/azrm-logo.png" alt="" width="18" height="18" />{BIG_WIN_MIN_POINTS / 1000}k+ win</span>
          {:else}
            <span class="legend-item"><span class="legend-dot is-sp"></span>SP</span>
            <span class="legend-item"><span class="legend-dot is-r"></span>R</span>
          {/if}
        </div>
      {/if}
    </div>

    {#if tableRows.length > 0}
      <MatchHistoryChart
        view={showPlacementHistory ? 'placement' : 'score'}
        {placementRows}
        {pointRows}
        ratingRows={history.ratingHistory}
        totalLabel={isSeasonScope ? 'Season SP' : 'Total SP'}
      />

      <div class="history-table">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th class="col-match">Match</th>
              {#if showSeasonColumn}
                <th class="col-season">Season</th>
              {/if}
              <th class="col-seat" style="width:70px;">Seat</th>
              <th style="width:70px;">Place</th>
              <th class="num" style="width:84px;">Score</th>
              <th class="num" style="width:76px;">SP Δ</th>
              {#if !data.isCasualSeason}
                <th class="num col-delta-r" style="width:66px;">ΔR</th>
                <th class="num col-rating" style="width:66px;">R</th>
              {/if}
            </tr>
          </thead>
          <tbody>
            {#each tableRows as r (r.match_id)}
              {@const spTone = signTone(r.club_points)}
              {@const rating = ratingByMatch.get(r.match_id)}
              {@const deltaTone = rating ? signTone(rating.delta, 1) : ''}
              <tr use:clickableRow={`/match/${r.match_id}`}>
                <td><DateText value={r.played_at} withTime /></td>
                <td class="col-match"><a href={`/match/${r.match_id}`} style="text-decoration:none;">{r.match_label}</a></td>
                {#if showSeasonColumn}
                  <td class="col-season">{seasonNames.get(r.season_id) ?? ''}</td>
                {/if}
                <td class="col-seat">
                  <span class="wind-cell">
                    <span class="wind" class:is-lit={r.seat === 'E'} lang="ja" aria-hidden="true">{windKanji(r.seat)}</span>
                    <span class="wind-letter"><span class="sr-only">{windName(r.seat)}</span><span aria-hidden="true">{r.seat}</span></span>
                  </span>
                </td>
                <td><span class="place-chip" data-place={r.placement}>{ordinal(r.placement)}</span></td>
                <td class="num" class:neg={r.raw_points < 0}>{fmtNum(r.raw_points, 0)}</td>
                <td class="num" class:pos={spTone === 'pos'} class:neg={spTone === 'neg'}>{fmtSigned(r.club_points, 1, true)}</td>
                {#if !data.isCasualSeason}
                  <td class="num col-delta-r" class:pos={deltaTone === 'pos'} class:neg={deltaTone === 'neg'}>{rating ? fmtSigned(rating.delta, 1, true) : '—'}</td>
                  <td class="num col-rating">{rating ? fmtNum(rating.new_rate, 0) : '—'}</td>
                {/if}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <div class="muted" style="margin-top:12px;">No matches yet.</div>
    {/if}
  </div>
{/if}
