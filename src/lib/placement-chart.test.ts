import { describe, expect, it } from 'vitest';
import {
  chartContentLayout,
  chartTickIndexes,
  chartTipAnchor,
  isBigWin,
  placementChartY
} from './placement-chart';

describe('chartContentLayout', () => {
  it('spreads games across the viewport when they fit', () => {
    expect(chartContentLayout(10, 300, 15, 24)).toEqual({ spacing: 30, contentWidth: 300 });
  });

  it('keeps the minimum spacing and grows wider than the viewport when they do not', () => {
    expect(chartContentLayout(29, 300, 15, 24)).toEqual({ spacing: 24, contentWidth: 702 });
  });

  it('does not scroll at exactly the minimum spacing', () => {
    expect(chartContentLayout(12, 294, 15, 24)).toEqual({ spacing: 24, contentWidth: 294 });
  });

  it('centers a single game without scrolling', () => {
    expect(chartContentLayout(1, 300, 15, 24).contentWidth).toBe(300);
    expect(chartContentLayout(0, 300, 15, 24).contentWidth).toBe(300);
  });
});

describe('chartTickIndexes', () => {
  it('labels every game when there is room', () => {
    expect(chartTickIndexes(5, 10)).toEqual([0, 1, 2, 3, 4]);
  });

  it('thins the labels but keeps the first and last game', () => {
    expect(chartTickIndexes(43, 10)).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 42]);
  });

  it('never exceeds the room available by more than the last label', () => {
    for (let count = 1; count <= 200; count += 1) {
      const ticks = chartTickIndexes(count, 8);
      expect(ticks[0]).toBe(0);
      expect(ticks[ticks.length - 1]).toBe(count - 1);
      expect(ticks.length).toBeLessThanOrEqual(9);
    }
  });

  it('handles an empty chart and a single game', () => {
    expect(chartTickIndexes(0, 8)).toEqual([]);
    expect(chartTickIndexes(1, 8)).toEqual([0]);
  });
});

describe('isBigWin', () => {
  it('needs both a first place and at least 50,000 points', () => {
    expect(isBigWin(1, 50000)).toBe(true);
    expect(isBigWin(1, 91600)).toBe(true);
    expect(isBigWin(1, 49900)).toBe(false);
    expect(isBigWin(2, 50000)).toBe(false);
    expect(isBigWin(1, undefined)).toBe(false);
  });
});

describe('chartTipAnchor', () => {
  const tip = { width: 190, height: 116 };

  it('centers above a point with room on every side', () => {
    expect(chartTipAnchor(500, 300, 1000, tip)).toEqual({ alignX: 'center', alignY: 'above' });
  });

  it('hugs the side edges so the tooltip stays inside the plot', () => {
    expect(chartTipAnchor(94, 300, 1000, tip).alignX).toBe('start');
    expect(chartTipAnchor(95, 300, 1000, tip).alignX).toBe('center');
    expect(chartTipAnchor(905, 300, 1000, tip).alignX).toBe('center');
    expect(chartTipAnchor(906, 300, 1000, tip).alignX).toBe('end');
  });

  it('drops below points too close to the top to fit above', () => {
    expect(chartTipAnchor(500, 115, 1000, tip).alignY).toBe('below');
    expect(chartTipAnchor(500, 116, 1000, tip).alignY).toBe('above');
  });
});

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
