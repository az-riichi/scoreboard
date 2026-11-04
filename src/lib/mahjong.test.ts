import { describe, expect, it } from 'vitest';
import { ordinal, seasonKanji, windKanji, windName } from './mahjong';

describe('mahjong display helpers', () => {
  it('maps seats to wind kanji and names', () => {
    expect(['E', 'S', 'W', 'N'].map(windKanji)).toEqual(['東', '南', '西', '北']);
    expect(['E', 'S', 'W', 'N'].map(windName)).toEqual(['East', 'South', 'West', 'North']);
    expect(windKanji('X')).toBe('X');
    expect(windName(null)).toBe('');
  });

  it('formats placements as ordinals', () => {
    expect([1, 2, 3, 4].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th']);
    expect(ordinal(11)).toBe('11th');
    expect(ordinal(22)).toBe('22nd');
    expect(ordinal(0)).toBe('—');
    expect(ordinal(undefined)).toBe('—');
  });

  it('picks a seasonal label from the season name', () => {
    expect(seasonKanji('Spring 2026')).toBe('春');
    expect(seasonKanji('Summer League')).toBe('夏');
    expect(seasonKanji('Fall 2026')).toBe('秋');
    expect(seasonKanji('Autumn Cup')).toBe('秋');
    expect(seasonKanji('Winter 2027')).toBe('冬');
    expect(seasonKanji('Season 4')).toBe('シーズン');
    expect(seasonKanji('Fall 2026', true)).toBe('カジュアル');
  });
});
