<script lang="ts">
  import { clickableRow } from '$lib/clickable-row';
  import DateText from '$lib/DateText.svelte';
  import { fmtNum, fmtSegScore, fmtSigned, signTone } from '$lib/ui';
  import { ordinal, windKanji, windName } from '$lib/mahjong';
  export let data: any;

  const seatOrder: Record<string, number> = { E: 1, S: 2, W: 3, N: 4 };
  $: results = [...data.results].sort(
    (a, b) => (seatOrder[a.seat] ?? 99) - (seatOrder[b.seat] ?? 99)
  );

  $: displayPlaceBySeat = (() => {
    const places = new Map<string, number>();
    const orderedByRaw = [...data.results].sort((a, b) => {
      if (a.raw_points !== b.raw_points) return b.raw_points - a.raw_points;
      return (seatOrder[a.seat] ?? 99) - (seatOrder[b.seat] ?? 99);
    });
    let idx = 0;
    while (idx < orderedByRaw.length) {
      const place = idx + 1;
      const raw = orderedByRaw[idx].raw_points;
      let next = idx + 1;
      while (next < orderedByRaw.length && orderedByRaw[next].raw_points === raw) next += 1;
      for (let rowIndex = idx; rowIndex < next; rowIndex += 1) {
        places.set(orderedByRaw[rowIndex].seat, place);
      }
      idx = next;
    }
    return places;
  })();

  $: displayPlaceByPlayer = new Map<string, number>(
    data.results
      .map((result: any) => [result.player_id, displayPlaceBySeat.get(result.seat)] as const)
      .filter((entry: readonly [string, number | undefined]): entry is readonly [string, number] => entry[1] != null)
  );

  $: matchLabel = data.match.table_label ?? data.match.id.slice(0, 8);

  function playerHref(playerId: string) {
    const eventQuery =
      data.isCasual && data.match.casual_event_id
        ? `&event=${encodeURIComponent(data.match.casual_event_id)}`
        : '';
    return `/player/${playerId}?season=${data.match.season_id}${eventQuery}`;
  }
</script>

<style>
  .match-board {
    display: grid;
    grid-template-columns: minmax(0, 300px) minmax(0, 1fr);
    gap: 20px;
    align-items: center;
    margin-top: 14px;
  }

  /* Top-down view of the table: East at the bottom, turn order runs counterclockwise. */
  .table-map {
    aspect-ratio: 1;
    width: 100%;
    box-sizing: border-box;
    display: grid;
    grid-template-columns: 1fr 1.05fr 1fr;
    grid-template-rows: 1fr 1.05fr 1fr;
    gap: 4px;
    padding: 14px;
    border-radius: 16px;
    box-shadow: inset 0 0 0 1px var(--screen-line), 0 0 0 5px var(--card-bg), 0 0 0 6px var(--card-border);
  }

  .table-seat {
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    text-align: center;
  }

  .seat-W { grid-area: 1 / 2; }
  .seat-N { grid-area: 2 / 1; }
  .seat-S { grid-area: 2 / 3; }
  .seat-E { grid-area: 3 / 2; }

  .table-seat__badges {
    display: flex;
    gap: 5px;
    align-items: center;
  }

  .table-seat__name {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--type-label);
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  /* Reads like the table's own display: lit segments over six dim, unlit digits. */
  .table-seat__pts {
    position: relative;
    min-width: calc(6 * 0.8156em);
    color: var(--led-score);
    font-family: var(--font-seg);
    font-size: 17px;
    font-weight: 700;
    line-height: 1.2;
    text-align: right;
  }

  .table-seat__pts::before {
    content: '888888';
    position: absolute;
    top: 0;
    right: 0;
    color: var(--led-dim);
    opacity: 0.22;
  }

  .table-map .place-chip {
    color: var(--led-mid);
    box-shadow: inset 0 0 0 1px var(--screen-line);
  }

  .table-map .place-chip[data-place='1'] {
    color: var(--accent-text);
    box-shadow: none;
  }

  .table-center {
    grid-area: 2 / 2;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    min-width: 0;
    border-radius: 10px;
    background: var(--screen-tint);
    box-shadow: inset 0 0 0 1px var(--screen-line);
    text-align: center;
  }

  .table-center__kanji {
    color: var(--led-amber);
    font-family: var(--font-led);
    font-size: 24px;
    line-height: 1.1;
  }

  .table-center__label {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--led-teal);
    font-size: var(--type-label);
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .match-meta {
    display: grid;
    gap: 2px;
    margin-top: 6px;
  }

  @media (max-width: 760px) {
    .match-board {
      grid-template-columns: minmax(0, 1fr);
    }

    .table-map {
      max-width: 340px;
      margin-inline: auto;
    }

    .table-seat__name {
      font-size: var(--type-small);
    }

    .table-seat__pts {
      font-size: 18px;
    }
  }

  /* Six digits must still fit a seat on the smallest phones. */
  @media (max-width: 360px) {
    .table-seat__pts {
      font-size: 14px;
    }
  }

  /* The table map above already shows each seat and place. */
  @media (max-width: 560px) {
    .col-seat,
    .col-place {
      display: none;
    }

    .col-value {
      width: auto !important;
    }
  }
</style>

<div class="card" style="margin-bottom:12px;">
  <div class="card-head">
    <div>
      <div class="title-row">
        <span class="led-tag" lang="ja" aria-hidden="true">対局</span>
        <h1 class="page-title">Match {matchLabel}</h1>
      </div>
      <div class="match-meta">
        <div class="muted">{data.season?.name ?? 'Unknown season'}{data.casualEvent ? ` · ${data.casualEvent.name}` : ''}</div>
        <div class="muted"><DateText value={data.match.played_at} withTime keepYear /></div>
        {#if Number(data.match.extra_sticks) > 0}
          <div class="muted">Sticks on the table: {fmtNum(data.match.extra_sticks, 0)}</div>
        {/if}
        {#if data.match.notes}
          <div class="muted">Note: {data.match.notes}</div>
        {/if}
      </div>
    </div>
    <a
      class="btn"
      href={`/season/${data.match.season_id}${data.match.casual_event_id ? `?event=${data.match.casual_event_id}` : ''}`}
    >
      Back to season
    </a>
  </div>
</div>

<div class="card" style="margin-bottom:12px;">
  <div class="title-row">
    <span class="led-tag" lang="ja" aria-hidden="true">結果</span>
    <h2 class="card-title">Results</h2>
  </div>

  <div class="match-board">
    <!-- Visual summary only; the table beside it carries the same results for assistive tech. -->
    <div class="table-map screen-panel" aria-hidden="true">
      {#each results as r (r.seat)}
        {@const place = displayPlaceBySeat.get(r.seat) ?? r.placement}
        <div class="table-seat seat-{r.seat}">
          <div class="table-seat__badges">
            <span class="wind" class:is-lit={r.seat === 'E'} lang="ja">{windKanji(r.seat)}</span>
            <span class="place-chip" data-place={place}>{ordinal(place)}</span>
          </div>
          <div class="table-seat__name">{r.player_name_primary}</div>
          <div class="table-seat__pts">{fmtSegScore(r.raw_points)}</div>
        </div>
      {/each}
      <div class="table-center">
        <span class="table-center__kanji" lang="ja">終局</span>
        <span class="table-center__label">{matchLabel}</span>
      </div>
    </div>

    <div style="overflow:auto; min-width:0;">
      <table>
        <thead>
          <tr>
            <th class="col-seat" style="width:80px;">Seat</th>
            <th>Player</th>
            <th class="num col-value" style="width:110px;">Points</th>
            <th class="num col-value" style="width:90px;">SP Δ</th>
            <th class="col-place" style="width:70px;">Place</th>
          </tr>
        </thead>
        <tbody>
          {#each results as r}
            {@const place = displayPlaceBySeat.get(r.seat) ?? r.placement}
            {@const spTone = signTone(r.club_points)}
            <tr use:clickableRow={playerHref(r.player_id)}>
              <td class="col-seat">
                <span class="wind-cell">
                  <span class="wind" class:is-lit={r.seat === 'E'} lang="ja" aria-hidden="true">{windKanji(r.seat)}</span>
                  <span class="wind-letter"><span class="sr-only">{windName(r.seat)}</span><span aria-hidden="true">{r.seat}</span></span>
                </span>
              </td>
              <td>
                <a href={playerHref(r.player_id)} style="text-decoration:none;">
                  {r.player_name_primary}
                  {#if r.player_name_secondary}
                    <span class="muted" style="margin-left:6px;">({r.player_name_secondary})</span>
                  {/if}
                </a>
              </td>
              <td class="num"><span class="led led-red">{fmtNum(r.raw_points, 0)}</span></td>
              <td class="num" class:pos={spTone === 'pos'} class:neg={spTone === 'neg'}>{fmtSigned(r.club_points, 2)}</td>
              <td class="col-place"><span class="place-chip" data-place={place}>{ordinal(place)}</span></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</div>

{#if data.ratingDeltas.length > 0}
  <div class="card">
    <div class="title-row">
      <span class="led-tag" lang="ja" aria-hidden="true">レート</span>
      <h2 class="card-title">Rating (R)</h2>
    </div>

    <div style="margin-top:12px; overflow:auto;">
      <table>
        <thead>
          <tr>
            <th>Player</th>
            <th class="col-place" style="width:80px;">Place</th>
            <th class="num col-value" style="width:120px;">ΔR</th>
            <th class="num col-value" style="width:120px;">New R</th>
          </tr>
        </thead>
        <tbody>
          {#each data.ratingDeltas as row}
            {@const place = displayPlaceByPlayer.get(row.player_id) ?? row.placement}
            {@const deltaTone = signTone(row.delta)}
            <tr use:clickableRow={playerHref(row.player_id)}>
              <td>
                <a href={playerHref(row.player_id)} style="text-decoration:none;">
                  {row.player_name_primary}
                  {#if row.player_name_secondary}
                    <span class="muted" style="margin-left:6px;">({row.player_name_secondary})</span>
                  {/if}
                </a>
              </td>
              <td class="col-place"><span class="place-chip" data-place={place}>{ordinal(place)}</span></td>
              <td class="num" class:pos={deltaTone === 'pos'} class:neg={deltaTone === 'neg'}>{fmtSigned(row.delta, 2)}</td>
              <td class="num">{fmtNum(row.new_rate, 2)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
{/if}
