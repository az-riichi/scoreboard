import { describe, expect, it } from 'vitest';
import { ratingGamesAdjustment } from './rating';

describe('ratingGamesAdjustment', () => {
  it.each([
    [0, 1],
    [1, 0.96],
    [10, 0.6],
    [20, 0.2],
    [21, 0.2]
  ])('maps %s games to %s', (games, expected) => {
    expect(ratingGamesAdjustment(games)).toBeCloseTo(expected);
  });
});
