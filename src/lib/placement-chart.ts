export function placementChartY(placement: number, plotTop: number, plotHeight: number): number | null {
  if (!Number.isInteger(placement) || placement < 1 || placement > 4) return null;
  return plotTop + ((placement - 1) / 3) * plotHeight;
}
