import { describe, expect, it } from 'vitest';
import { sanitizeLocalRedirect } from './safe-redirect';

describe('sanitizeLocalRedirect', () => {
  it('keeps same-origin paths, queries, and fragments', () => {
    expect(sanitizeLocalRedirect('/admin/matches?season=active#recent')).toBe(
      '/admin/matches?season=active#recent'
    );
  });

  it.each([
    'https://example.com',
    '//example.com/path',
    '/\\example.com/path',
    '/%5cexample.com/path',
    '/%2f%2fexample.com/path',
    '/%2509example.com/path',
    '/bad%encoding'
  ])('rejects unsafe redirect %s', (value) => {
    expect(sanitizeLocalRedirect(value)).toBeNull();
  });
});
