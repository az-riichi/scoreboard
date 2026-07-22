import { describe, expect, it } from 'vitest';
import { placementChartY } from './placement-chart';

describe('placementChartY', () => {
  it('places first at the top and fourth at the bottom', () => {
    expect(placementChartY(1, 18, 390)).toBe(18);
    expect(placementChartY(2, 18, 390)).toBe(148);
    expect(placementChartY(3, 18, 390)).toBe(278);
    expect(placementChartY(4, 18, 390)).toBe(408);
  });

  it.each([0, 1.5, 5, Number.NaN])('rejects invalid placement %s', (placement) => {
    expect(placementChartY(placement, 18, 390)).toBeNull();
  });
});
