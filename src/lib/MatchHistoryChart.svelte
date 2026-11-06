<script lang="ts">
  import { tick } from 'svelte';
  import { ordinal } from '$lib/mahjong';
  import {
    chartContentLayout,
    chartTickIndexes,
    chartTipAnchor,
    isBigWin,
    placementChartY
  } from '$lib/placement-chart';
  import { fmtDate, fmtNum, fmtSigned, signTone } from '$lib/ui';
  import type {
    PlayerPlacementHistoryRow,
    PlayerPointHistoryRow,
    RatingHistoryRow
  } from '$lib/public-data/types';

  export let view: 'placement' | 'score';
  export let placementRows: PlayerPlacementHistoryRow[] = [];
  export let pointRows: PlayerPointHistoryRow[] = [];
  export let ratingRows: RatingHistoryRow[] = [];
  export let totalLabel = 'Total SP';

  type Tip = {
    heading: string;
    rows: { label: string; value: string; tone: '' | 'pos' | 'neg' }[];
    footer: string;
  };
  type Mark = { y: number; color: string; logo: boolean };
  type Game = {
    key: string;
    href: string;
    x: number;
    y: number;
    hitX: number;
    hitWidth: number;
    marks: Mark[];
    tip: Tip;
  };

  const TIP_WIDTH = 190;
  const PLACE_TICKS = [1, 2, 3, 4];

  function seriesRange(values: number[]): [number, number] {
    if (values.length === 0) return [0, 1];
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

  function pathFrom(points: { x: number; y: number }[]) {
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  }

  function tipFor(row: PlayerPlacementHistoryRow | PlayerPointHistoryRow, rows: Tip['rows']): Tip {
    return {
      heading: `${ordinal(row.placement)} place`,
      rows,
      footer: `${row.match_label} · ${fmtDate(row.played_at)}`
    };
  }

  function buildChart(
    width: number,
    chartView: 'placement' | 'score',
    placements: PlayerPlacementHistoryRow[],
    points: PlayerPointHistoryRow[],
    ratings: RatingHistoryRow[],
    totalName: string
  ) {
    const isPlacement = chartView === 'placement';
    const compact = width < 560;
    const height = Math.round(Math.min(420, Math.max(compact ? 200 : 280, width * 0.4)));
    const maxLogoRadius = compact ? 11 : 15;
    const margin = isPlacement
      ? { left: 34, right: 8, top: maxLogoRadius + 4, bottom: 28 }
      : { left: 44, right: 46, top: 14, bottom: 28 };
    const inset = maxLogoRadius + 3;
    const viewportWidth = Math.max(1, width - margin.left - margin.right);
    const plotHeight = height - margin.top - margin.bottom;
    const plotBottom = margin.top + plotHeight;
    const count = isPlacement ? placements.length : points.length;
    // A long history scrolls on a phone. Larger screens can fit far more before they need to.
    const { spacing, contentWidth } = chartContentLayout(count, viewportWidth, inset, compact ? 24 : 14);
    const xAt = (index: number) => (count > 1 ? inset + index * spacing : contentWidth / 2);

    const dotRadius = Math.min(compact ? 5.5 : 7, spacing * 0.42);
    // Sized so neighboring logos do not overlap.
    const logoRadius = Math.max(9, Math.min(maxLogoRadius, spacing / 2));

    const hitFor = (index: number) => {
      const x = xAt(index);
      const start = index === 0 ? 0 : x - spacing / 2;
      const end = index === count - 1 ? contentWidth : x + spacing / 2;
      return { x, hitX: start, hitWidth: end - start };
    };

    const ratingsByMatch = new Map(ratings.map((row) => [row.match_id, row]));
    const spRange = seriesRange(points.map((row) => row.cumulative_points));
    const shownRatings = points.flatMap((row) => {
      const rating = ratingsByMatch.get(row.match_id);
      return rating ? [rating.new_rate] : [];
    });
    const rRange = seriesRange(shownRatings);
    const yIn = ([min, max]: [number, number], value: number) =>
      margin.top + (1 - (value - min) / (max - min)) * plotHeight;

    const games: Game[] = isPlacement
      ? placements.map((row, index) => {
          const y = placementChartY(row.placement, margin.top, plotHeight) ?? margin.top;
          return {
            ...hitFor(index),
            key: row.match_id,
            href: `/match/${row.match_id}`,
            y,
            marks: [{ y, color: 'var(--led-green)', logo: isBigWin(row.placement, row.raw_points) }],
            tip: tipFor(row, [
              { label: 'Points', value: fmtNum(row.raw_points, 0), tone: '' },
              { label: 'SP', value: fmtSigned(row.club_points, 1, true), tone: signTone(row.club_points, 1) }
            ])
          };
        })
      : points.map((row, index) => {
          const delta = row.points_with_adjustments ?? row.club_points;
          const rating = ratingsByMatch.get(row.match_id);
          const spY = yIn(spRange, row.cumulative_points);
          const rY = rating ? yIn(rRange, rating.new_rate) : null;
          return {
            ...hitFor(index),
            key: row.match_id,
            href: `/match/${row.match_id}`,
            y: rY == null ? spY : Math.min(spY, rY),
            marks: [
              { y: spY, color: 'var(--led-teal)', logo: false },
              ...(rY == null ? [] : [{ y: rY, color: 'var(--led-amber)', logo: false }])
            ],
            tip: tipFor(row, [
              { label: 'Points', value: fmtNum(row.raw_points, 0), tone: '' },
              { label: 'SP', value: fmtSigned(delta, 1, true), tone: signTone(delta, 1) },
              { label: totalName, value: fmtSigned(row.cumulative_points, 1, true), tone: '' },
              ...(rating
                ? [
                    { label: 'R', value: fmtNum(rating.new_rate, 0), tone: '' as const },
                    { label: 'ΔR', value: fmtSigned(rating.delta, 1, true), tone: signTone(rating.delta, 1) }
                  ]
                : [])
            ])
          };
        });

    return {
      width,
      height,
      compact,
      isPlacement,
      margin,
      viewportWidth,
      contentWidth,
      plotBottom,
      dotRadius,
      logoRadius,
      ringWidth: dotRadius < 4 ? 1 : 2,
      games,
      // Logos paint last, so no neighboring dot covers one.
      marks: games
        .flatMap((game) => game.marks.map((mark, index) => ({ ...mark, x: game.x, gameKey: game.key, id: `${game.key}-${index}` })))
        .sort((a, b) => Number(a.logo) - Number(b.logo)),
      lines: isPlacement
        ? [{ key: 'place', color: 'var(--led-green)', glow: 'line-place', d: pathFrom(games.map((g) => ({ x: g.x, y: g.marks[0].y }))) }]
        : [
            { key: 'sp', color: 'var(--led-teal)', glow: 'line-sp', d: pathFrom(games.map((g) => ({ x: g.x, y: g.marks[0].y }))) },
            {
              key: 'r',
              color: 'var(--led-amber)',
              glow: 'line-r',
              d: pathFrom(games.flatMap((g) => (g.marks[1] ? [{ x: g.x, y: g.marks[1].y }] : [])))
            }
          ],
      xTicks: chartTickIndexes(count, Math.floor(contentWidth / (compact ? 34 : 44))).map((index) => ({
        index,
        x: xAt(index)
      })),
      yGrid: isPlacement
        ? PLACE_TICKS.map((place) => placementChartY(place, margin.top, plotHeight) ?? margin.top)
        : [0, 0.25, 0.5, 0.75, 1].map((t) => margin.top + plotHeight * t),
      spRange,
      rRange,
      tipHeight: isPlacement ? 122 : 196
    };
  }

  let measuredWidth = 0;
  let scrollLeft = 0;
  let activeGame: Game | null = null;
  let tipIsTouch = false;
  let root: HTMLDivElement;
  let press: { touch: boolean; wasActive: boolean } | null = null;

  $: chart = buildChart(measuredWidth, view, placementRows, pointRows, ratingRows, totalLabel);
  // A redraw can remove the hovered game without firing its mouseleave.
  $: if (chart) activeGame = null;
  $: maxScroll = chart.contentWidth - chart.viewportWidth;
  $: pinKey = `${view}|${chart.games.length}|${chart.contentWidth}`;
  // The tooltip sits outside the scroller so it is not clipped, and follows its game while scrolling.
  $: tipX = activeGame ? chart.margin.left + activeGame.x - scrollLeft : 0;
  $: tipInView = tipX >= chart.margin.left - 1 && tipX <= chart.width - chart.margin.right + 1;
  $: tipAnchor = activeGame && tipInView
    ? chartTipAnchor(tipX, activeGame.y, chart.width, { width: TIP_WIDTH, height: chart.tipHeight })
    : null;

  // Long histories open on the newest games.
  function pinToLatest(node: HTMLElement, _key: string) {
    const pin = () => {
      node.scrollLeft = node.scrollWidth;
      scrollLeft = node.scrollLeft;
    };
    pin();
    // Updates run before the wider chart is drawn, so wait for the new scroll width.
    return { update: () => tick().then(pin) };
  }

  function showTip(game: Game) {
    activeGame = game;
  }

  function hideTip(game: Game) {
    if (activeGame?.key === game.key) activeGame = null;
  }

  // Touch has no hover: the first tap shows the tooltip, a second tap opens the match.
  function onPointerDown(event: PointerEvent, game: Game) {
    const touch = event.pointerType !== 'mouse';
    press = { touch, wasActive: activeGame?.key === game.key };
    tipIsTouch = touch;
  }

  function onClick(event: MouseEvent, game: Game) {
    if (press?.touch && !press.wasActive) {
      event.preventDefault();
      activeGame = game;
    }
    press = null;
  }

  function onDocumentClick(event: MouseEvent) {
    if (activeGame && event.target instanceof Node && !root?.contains(event.target)) activeGame = null;
  }

  function ariaLabel(tip: Tip) {
    return `${tip.footer}. ${tip.heading}. ${tip.rows.map((row) => `${row.label} ${row.value}`).join(', ')}`;
  }
</script>

<svelte:document on:click={onDocumentClick} />

<style>
  .history-chart {
    margin-top: 12px;
    padding: 6px;
  }

  .history-plot {
    position: relative;
    min-height: 200px;
  }

  svg {
    display: block;
    max-width: none;
  }

  .chart-axis {
    position: absolute;
    inset: 0 auto auto 0;
    pointer-events: none;
  }

  .chart-scroller {
    position: relative;
    overflow: hidden;
  }

  /* Only when the games truly do not fit: otherwise a sub-pixel rounding
     difference can make the browser draw a scrollbar with nothing to scroll. */
  .chart-scroller.is-scrollable {
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: thin;
    scrollbar-color: var(--led-dim) transparent;
  }

  /* A soft edge shows there are more games to scroll to. */
  .chart-fade {
    position: absolute;
    top: 0;
    width: 22px;
    pointer-events: none;
  }

  .chart-fade.is-left {
    background: linear-gradient(90deg, var(--screen), transparent);
  }

  .chart-fade.is-right {
    background: linear-gradient(270deg, var(--screen), transparent);
  }

  text {
    font-family: var(--font-ui);
    font-weight: 500;
  }

  .line-sp { filter: drop-shadow(0 0 4px var(--glow-teal)); }
  .line-r { filter: drop-shadow(0 0 4px var(--glow-amber)); }
  .line-place { filter: drop-shadow(0 0 4px var(--glow-green)); }

  .chart-hit {
    fill: transparent;
  }

  .chart-marks {
    pointer-events: none;
  }

  .chart-hairline {
    stroke: var(--led-mid);
    stroke-width: 1;
    pointer-events: none;
  }

  .chart-mark.is-active {
    stroke: var(--text);
  }

  .chart-tip {
    --tip-x: -50%;
    --tip-y: calc(-100% - 20px);
    position: absolute;
    z-index: 5;
    box-sizing: border-box;
    width: 190px;
    padding: 9px 11px;
    border: 1px solid var(--card-border);
    border-radius: 8px;
    background: var(--card-bg);
    box-shadow: var(--raised-shadow);
    color: var(--text);
    font-size: var(--type-small);
    line-height: 1.35;
    text-decoration: none;
    pointer-events: none;
    transform: translate(var(--tip-x), var(--tip-y));
  }

  .chart-tip.is-touch {
    pointer-events: auto;
  }

  .chart-tip.is-start { --tip-x: -20px; }
  .chart-tip.is-end { --tip-x: calc(-100% + 20px); }
  .chart-tip.is-below { --tip-y: 20px; }

  .chart-tip__heading {
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .chart-tip__rows {
    display: grid;
    gap: 2px;
    margin: 4px 0 0;
  }

  .chart-tip__rows div {
    display: flex;
    justify-content: space-between;
    gap: 10px;
  }

  .chart-tip__rows dt {
    color: var(--muted);
  }

  .chart-tip__rows dd {
    margin: 0;
    font-family: var(--font-num);
    font-size: var(--type-num);
    line-height: 1.1;
    white-space: nowrap;
  }

  .chart-tip__footer {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    margin-top: 6px;
    padding-top: 5px;
    border-top: 1px solid var(--table-row);
    color: var(--muted);
    font-size: var(--type-label);
  }
</style>

<div class="history-chart screen-panel" bind:this={root}>
  <div class="history-plot" bind:clientWidth={measuredWidth}>
    {#if measuredWidth > 0}
      {@const axisSize = chart.compact ? 13 : 14}
      <!-- The value axes stay put while the games scroll between them. -->
      <svg class="chart-axis" width={chart.width} height={chart.height} aria-hidden="true">
        {#if chart.isPlacement}
          {#each PLACE_TICKS as place, index (place)}
            <text
              x={chart.margin.left - 6}
              y={chart.yGrid[index]}
              text-anchor="end"
              dominant-baseline="middle"
              font-size={axisSize}
              fill="var(--led-mid)"
            >
              {ordinal(place)}
            </text>
          {/each}
        {:else}
          <text x={chart.margin.left - 6} y={chart.margin.top + 4} text-anchor="end" dominant-baseline="hanging" font-size={axisSize} fill="var(--led-teal)">{fmtNum(chart.spRange[1], 0)}</text>
          <text x={chart.margin.left - 6} y={chart.plotBottom - 4} text-anchor="end" font-size={axisSize} fill="var(--led-teal)">{fmtNum(chart.spRange[0], 0)}</text>
          <text x={chart.width - chart.margin.right + 6} y={chart.margin.top + 4} text-anchor="start" dominant-baseline="hanging" font-size={axisSize} fill="var(--led-amber)">{fmtNum(chart.rRange[1], 0)}</text>
          <text x={chart.width - chart.margin.right + 6} y={chart.plotBottom - 4} text-anchor="start" font-size={axisSize} fill="var(--led-amber)">{fmtNum(chart.rRange[0], 0)}</text>
        {/if}
      </svg>

      <div
        class="chart-scroller"
        class:is-scrollable={maxScroll > 0}
        style={`margin-left:${chart.margin.left}px; margin-right:${chart.margin.right}px;`}
        use:pinToLatest={pinKey}
        on:scroll={(event) => (scrollLeft = event.currentTarget.scrollLeft)}
      >
        <svg width={chart.contentWidth} height={chart.height}>
          {#each chart.yGrid as y}
            <line
              x1="0"
              y1={y}
              x2={chart.contentWidth}
              y2={y}
              stroke="var(--led-dim)"
              stroke-opacity="0.45"
              stroke-dasharray="3 3"
            />
          {/each}

          {#each chart.xTicks as tick (tick.index)}
            <text
              x={tick.x}
              y={chart.plotBottom + 8}
              text-anchor="middle"
              dominant-baseline="hanging"
              font-size={axisSize}
              fill="var(--led-mid)"
            >
              {tick.index + 1}
            </text>
          {/each}

          {#each chart.lines as line (line.key)}
            <path class={line.glow} d={line.d} fill="none" stroke={line.color} stroke-width="2" />
          {/each}

          {#if activeGame}
            <line class="chart-hairline" x1={activeGame.x} y1={chart.margin.top} x2={activeGame.x} y2={chart.plotBottom} />
          {/if}

          <g class="chart-marks">
            {#each chart.marks as mark (mark.id)}
              {@const isActive = activeGame?.key === mark.gameKey}
              {#if mark.logo}
                <circle class="chart-mark" class:is-active={isActive} cx={mark.x} cy={mark.y} r={chart.logoRadius} fill="var(--screen)" stroke="transparent" stroke-width="2" />
                <image href="/azrm-logo.png" x={mark.x - chart.logoRadius} y={mark.y - chart.logoRadius} width={chart.logoRadius * 2} height={chart.logoRadius * 2} />
              {:else}
                <circle class="chart-mark" class:is-active={isActive} cx={mark.x} cy={mark.y} r={chart.dotRadius} fill={mark.color} stroke="var(--screen)" stroke-width={chart.ringWidth} />
              {/if}
            {/each}
          </g>

          {#each chart.games as game (game.key)}
            <a
              href={game.href}
              aria-label={ariaLabel(game.tip)}
              on:mouseenter={() => showTip(game)}
              on:mouseleave={() => hideTip(game)}
              on:focus={() => showTip(game)}
              on:blur={() => hideTip(game)}
              on:pointerdown={(event) => onPointerDown(event, game)}
              on:click={(event) => onClick(event, game)}
            >
              <rect class="chart-hit" x={game.hitX} y="0" width={game.hitWidth} height={chart.height} />
            </a>
          {/each}
        </svg>
      </div>

      {#if scrollLeft > 2}
        <div class="chart-fade is-left" style={`left:${chart.margin.left}px; height:${chart.plotBottom}px;`}></div>
      {/if}
      {#if scrollLeft < maxScroll - 2}
        <div class="chart-fade is-right" style={`right:${chart.margin.right}px; height:${chart.plotBottom}px;`}></div>
      {/if}
    {/if}

    {#if activeGame && tipAnchor}
      <a
        class="chart-tip is-{tipAnchor.alignX} is-{tipAnchor.alignY}"
        class:is-touch={tipIsTouch}
        href={activeGame.href}
        style={`left:${tipX}px; top:${activeGame.y}px;`}
        aria-hidden="true"
        tabindex="-1"
      >
        <div class="chart-tip__heading">{activeGame.tip.heading}</div>
        <dl class="chart-tip__rows">
          {#each activeGame.tip.rows as row (row.label)}
            <div>
              <dt>{row.label}</dt>
              <dd class:pos={row.tone === 'pos'} class:neg={row.tone === 'neg'}>{row.value}</dd>
            </div>
          {/each}
        </dl>
        <div class="chart-tip__footer">
          <span>{activeGame.tip.footer}</span>
          {#if tipIsTouch}<span aria-hidden="true">›</span>{/if}
        </div>
      </a>
    {/if}
  </div>
</div>
