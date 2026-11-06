export function placementChartY(placement: number, plotTop: number, plotHeight: number): number | null {
  if (!Number.isInteger(placement) || placement < 1 || placement > 4) return null;
  return plotTop + ((placement - 1) / 3) * plotHeight;
}

/** Evenly spaced axis labels that always include the first and last game. */
export function chartTickIndexes(count: number, maxTicks: number): number[] {
  if (count <= 0) return [];
  const stride = Math.max(1, Math.ceil(count / Math.max(1, maxTicks)));
  const ticks: number[] = [];
  for (let index = 0; index < count; index += stride) ticks.push(index);

  const last = count - 1;
  if (ticks[ticks.length - 1] !== last) {
    // Replace the tick that would crowd the last label.
    if (ticks.length > 1 && last - ticks[ticks.length - 1] < stride) ticks.pop();
    ticks.push(last);
  }
  return ticks;
}

/**
 * Spreads games across the viewport when they fit. A longer history keeps its
 * minimum spacing and becomes wider than the viewport, so it scrolls instead of
 * crowding together.
 */
export function chartContentLayout(
  count: number,
  viewportWidth: number,
  inset: number,
  minSpacing: number
): { spacing: number; contentWidth: number } {
  const room = Math.max(1, viewportWidth - inset * 2);
  if (count < 2) return { spacing: room, contentWidth: viewportWidth };

  const fitted = room / (count - 1);
  if (fitted >= minSpacing) return { spacing: fitted, contentWidth: viewportWidth };
  return { spacing: minSpacing, contentWidth: inset * 2 + minSpacing * (count - 1) };
}

export const BIG_WIN_MIN_POINTS = 50000;

export function isBigWin(placement: unknown, rawPoints: unknown): boolean {
  return placement === 1 && Number(rawPoints) >= BIG_WIN_MIN_POINTS;
}

export type ChartTipAnchor = {
  alignX: 'start' | 'center' | 'end';
  alignY: 'above' | 'below';
};

/** Keeps a tooltip inside the plot: it hugs the side edges and drops below points near the top. */
export function chartTipAnchor(
  xPx: number,
  yPx: number,
  plotWidthPx: number,
  tip: { width: number; height: number }
): ChartTipAnchor {
  let alignX: ChartTipAnchor['alignX'] = 'center';
  if (xPx < tip.width / 2) alignX = 'start';
  else if (xPx > plotWidthPx - tip.width / 2) alignX = 'end';

  return { alignX, alignY: yPx < tip.height ? 'below' : 'above' };
}
