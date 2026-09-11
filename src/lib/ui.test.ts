import { describe, expect, it } from 'vitest';
import { fmtDate, fmtDateTime, fmtFixed, fmtNum, fmtPct } from './ui';

describe('cached UI formatters', () => {
  it('preserves local date and date-time formatting', () => {
    for (const value of ['2026-09-11T12:34:00Z', '2026-01-01T00:00:00Z']) {
      const date = new Date(value);
      expect(fmtDate(value)).toBe(date.toLocaleDateString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric'
      }));
      expect(fmtDateTime(value)).toBe(date.toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      }));
    }
  });

  it('preserves invalid-date output', () => {
    expect(fmtDate('invalid')).toBe('Invalid Date');
    expect(fmtDateTime('invalid')).toBe('Invalid Date');
  });

  it('keeps precision settings independent when reusing formatters', () => {
    for (const digits of [2, 0, 1, 2, 0]) {
      for (const value of [12345.678, -9876.543, 0, -0, Infinity]) {
        expect(fmtNum(value, digits)).toBe(value.toLocaleString(undefined, {
          maximumFractionDigits: digits
        }));
      }
      for (const value of [12345.678, -9876.543, 0, -0]) {
        expect(fmtFixed(value, digits)).toBe(value.toLocaleString(undefined, {
          minimumFractionDigits: digits, maximumFractionDigits: digits
        }));
      }
    }
  });

  it('preserves missing-value fallbacks and fixed trailing zeros', () => {
    for (const value of [null, undefined, Number.NaN]) {
      expect(fmtNum(value)).toBe('0');
      expect(fmtPct(value)).toBe('0%');
      expect(fmtFixed(value)).toBe('0.00');
    }
    expect(fmtFixed(Infinity, 1)).toBe('0.0');
    expect(fmtFixed(undefined, 0)).toBe('0');
    expect(fmtPct(0.555)).toBe('56%');
  });
});
