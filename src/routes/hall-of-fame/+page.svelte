<script lang="ts">
  import { fmtFixed, fmtNum, fmtSigned, signTone } from '$lib/ui';
  import { seasonKanji } from '$lib/mahjong';
  import type { HallGroup, HallTone } from '$lib/public-data/hall-of-fame';

  export let data: import('./$types').PageData;

  const TONE_CLASS: Record<HallTone, string> = {
    glory: 'led-amber',
    shame: 'led-neg',
    neutral: 'led-teal'
  };

  type RecordSection = {
    key: string;
    kanji: string;
    title: string;
    groups: HallGroup[];
  };

  let sections: RecordSection[] = [];
  $: sections = [
    {
      key: 'matches',
      kanji: '対局記録',
      title: 'Match records',
      groups: data.matchGroups
    },
    {
      key: 'players',
      kanji: '雀士記録',
      title: 'Player records',
      groups: data.playerGroups
    }
  ];
</script>

<style>
  .hof-head .muted {
    margin-top: 4px;
  }
  .hof-scope {
    margin-top: 12px;
  }
  .hof-section {
    margin-top: 12px;
  }
  .hof-group-title {
    margin: 18px 0 8px;
    color: var(--led-teal);
    font-size: var(--type-label);
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .hof-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 290px), 1fr));
    gap: 10px;
  }
  .hof-podiums {
    margin-top: 12px;
  }

  /* Podium tiles */
  .hof-podium__head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    min-width: 0;
  }
  .hof-podium__season {
    min-width: 0;
    font-weight: 600;
    text-decoration: none;
  }
  .hof-podium__season:hover {
    color: var(--accent);
  }
  .hof-podium__rows {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
    margin: 4px 0 0;
    padding: 0;
    list-style: none;
  }
  .hof-podium__row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    text-decoration: none;
  }
  .hof-podium__row:hover .hof-clip {
    color: var(--accent);
  }

  /* Record tiles */
  .hof-record__title {
    margin: 0;
    color: var(--text);
    font-size: var(--type-small);
  }
  .hof-record__desc {
    margin-top: 2px;
    color: var(--muted);
    font-size: var(--type-small);
    line-height: 1.3;
  }
  .hof-lead {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 10px;
    margin-top: 4px;
    min-width: 0;
  }
  .hof-holder {
    min-width: 0;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .hof-holder a {
    text-decoration: none;
  }
  .hof-holder a:hover {
    color: var(--accent);
  }
  .hof-holder__secondary,
  .hof-holder__joiner {
    color: var(--muted);
    font-weight: 400;
    font-size: var(--type-small);
  }
  .hof-detail {
    color: var(--muted);
    font-size: var(--type-small);
    line-height: 1.3;
    text-decoration: none;
  }
  a.hof-detail:hover {
    color: var(--accent);
  }
  .hof-ongoing {
    font-size: var(--type-label);
  }

  /* One game's final scores. */
  .hof-table {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 2px;
    padding-top: 7px;
    border-top: 1px solid var(--table-row);
    text-decoration: none;
  }
  .hof-table:hover .hof-seat__name {
    color: var(--accent);
  }
  .hof-seat {
    display: grid;
    gap: 2px;
    min-width: 0;
    text-align: center;
  }
  .hof-seat__name {
    overflow: hidden;
    color: var(--led-mid);
    font-size: var(--type-label);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hof-seat__pts {
    color: var(--led-score);
    font-family: var(--font-num);
    font-size: var(--type-num);
    line-height: 1.2;
    white-space: nowrap;
  }
  .hof-seat.is-holder .hof-seat__name {
    color: var(--led-amber);
    font-weight: 700;
  }
  .hof-seat.is-holder .hof-seat__pts {
    color: var(--led-amber);
  }

  /* Runners-up */
  .hof-runners {
    display: grid;
    /* Without this, long text that cannot wrap widens the whole card. */
    grid-template-columns: minmax(0, 1fr);
    gap: 3px;
    margin: 2px 0 0;
    padding: 7px 0 0;
    border-top: 1px solid var(--table-row);
    list-style: none;
  }
  .hof-runner {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    font-size: var(--type-note);
    text-decoration: none;
  }
  .hof-runner:hover .hof-clip {
    color: var(--accent);
  }
  .hof-runner .rank-led {
    min-width: 22px;
    height: 24px;
    padding: 0 3px;
  }
  .hof-clip {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hof-runner__value {
    color: var(--led-mid);
    font-family: var(--font-num);
    font-size: var(--type-num);
    line-height: 1.1;
    white-space: nowrap;
  }
  .hof-more {
    color: var(--muted);
    font-size: var(--type-label);
  }

  /* Four scores must still fit side by side on the smallest phones. */
  @media (max-width: 360px) {
    .hof-seat__pts {
      font-size: var(--type-body);
    }
  }
</style>

<div class="card hof-head">
  <div class="title-row">
    <span class="led-tag" lang="ja" aria-hidden="true">殿堂</span>
    <h1 class="page-title">Hall of Fame</h1>
  </div>
  <div class="muted">
    {data.gameCount} {data.gameCount === 1 ? 'game' : 'games'}, {data.playerCount} {data.playerCount === 1 ? 'player' : 'players'}
  </div>

  <nav class="seg hof-scope" aria-label="Hall of Fame season">
    {#each data.scopes as scope (scope.id ?? 'all-time')}
      <a
        href={scope.href}
        class:is-active={scope.id === data.seasonId}
        aria-current={scope.id === data.seasonId ? 'page' : undefined}
      >
        {scope.label}
      </a>
    {/each}
  </nav>
</div>

{#if data.podiums.length > 0}
  <section class="card hof-section">
    <div class="title-row">
      <span class="led-tag" lang="ja" aria-hidden="true">{data.isAllTime ? '歴代王者' : '表彰台'}</span>
      <h2 class="card-title">{data.isAllTime ? 'Season champions' : 'Podium'}</h2>
    </div>

    <div class="hof-grid hof-podiums">
      {#each data.podiums as podium (podium.season.id)}
        <div class="stat-tile">
          <div class="hof-podium__head">
            <a class="hof-podium__season wind-cell" href={`/season/${podium.season.id}`}>
              <span class="wind" class:is-lit={podium.season.is_active} lang="ja" aria-hidden="true">{seasonKanji(podium.season.name, podium.season.is_casual)}</span>
              {podium.season.name}
            </a>
            {#if podium.season.is_active}
              <span class="status-live hof-ongoing"><span class="led-dot is-on is-blink" aria-hidden="true"></span>In progress</span>
            {/if}
          </div>
          <ol class="hof-podium__rows">
            {#each podium.rows as row (row.player_id)}
              {@const tone = signTone(row.points, 1)}
              <li>
                <a class="hof-podium__row" href={row.href}>
                  <span class="rank-led" data-rank={row.rank}>{row.rank}</span>
                  <span class="hof-clip">
                    {row.player_name_primary}
                    {#if row.player_name_secondary}
                      <span class="muted">({row.player_name_secondary})</span>
                    {/if}
                  </span>
                  <span class="led" class:led-pos={tone === 'pos'} class:led-neg={tone === 'neg'}>{fmtSigned(row.points, 1, true)}</span>
                </a>
              </li>
            {/each}
          </ol>
        </div>
      {/each}
    </div>
  </section>
{/if}

{#if data.gameCount === 0}
  <div class="card hof-section muted">No finalized matches in this season yet.</div>
{/if}

{#each sections as section (section.key)}
  {#if section.groups.length > 0}
    <section class="card hof-section">
      <div class="title-row">
        <span class="led-tag" lang="ja" aria-hidden="true">{section.kanji}</span>
        <h2 class="card-title">{section.title}</h2>
      </div>

      {#each section.groups as group (group.key)}
        <h3 class="hof-group-title">{group.title}</h3>
        <div class="hof-grid">
          {#each group.records as record (record.key)}
            {@const lead = record.entries[0]}
            {@const runners = record.entries.slice(1)}
            <article class="stat-tile">
              <div>
                <h4 class="stat-label hof-record__title">{record.title}</h4>
                <div class="hof-record__desc">{record.description}</div>
              </div>

              <div class="hof-lead">
                <span class="led led-md {TONE_CLASS[record.tone]}">{lead.valueText}</span>
                {#if lead.players.length > 0}
                  <div class="hof-holder">
                    {#each lead.players as player, index (player.player_id)}
                      {#if index > 0}
                        <span class="hof-holder__joiner">{lead.joiner}</span>
                      {/if}
                      <a href={player.href}>{player.player_name_primary}</a>
                      {#if player.player_name_secondary && lead.players.length === 1}
                        <span class="hof-holder__secondary">({player.player_name_secondary})</span>
                      {/if}
                    {/each}
                  </div>
                {/if}
              </div>

              <a class="hof-detail" href={lead.href}>{lead.detail}</a>

              {#if lead.ongoing}
                <span class="status-live hof-ongoing"><span class="led-dot is-on is-blink" aria-hidden="true"></span>Still going</span>
              {/if}

              {#if lead.table}
                <a class="hof-table" href={lead.href}>
                  {#each lead.table as seat (seat.player_id)}
                    <span class="hof-seat" class:is-holder={seat.is_holder}>
                      <span class="hof-seat__name">{seat.name}</span>
                      <span class="hof-seat__pts">{fmtNum(seat.raw_points, 0)}</span>
                    </span>
                  {/each}
                </a>
              {/if}

              {#if runners.length > 0}
                <ol class="hof-runners">
                  {#each runners as entry, index (index)}
                    <li>
                      <a class="hof-runner" href={entry.href}>
                        <span class="rank-led" data-rank={entry.rank}>{entry.rank}</span>
                        <span class="hof-clip">
                          {#if entry.players.length > 0}
                            {entry.players.map((player) => player.player_name_primary).join(` ${entry.joiner ?? ''} `)}
                          {:else}
                            {entry.detail}
                          {/if}
                        </span>
                        <span class="hof-runner__value">{entry.valueText}</span>
                      </a>
                    </li>
                  {/each}
                </ol>
              {/if}

              {#if record.moreTied > 0}
                <div class="hof-more">+{record.moreTied} more tied at {record.entries[record.entries.length - 1].valueText}</div>
              {/if}
            </article>
          {/each}
        </div>
      {/each}
    </section>
  {/if}
{/each}
