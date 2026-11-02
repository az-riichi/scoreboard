import { createClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { loadNextGameNumber } from './matches';

const dayBounds = {
  dayStart: '2026-07-21T07:00:00.000Z',
  dayEnd: '2026-07-22T07:00:00.000Z'
};

function mockClient(rows: Array<{ game_number: number | null }>, status = 200) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(
    JSON.stringify(status === 200 ? rows : { message: 'Database unavailable' }),
    { status, headers: { 'content-type': 'application/json' } }
  ));
  const supabase = createClient('https://scoreboard.example', 'public-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch }
  });
  return { supabase, fetch };
}

describe('loadNextGameNumber', () => {
  it('requests only the highest game number within the same season, table, and Arizona day', async () => {
    const { supabase, fetch } = mockClient([{ game_number: 1500 }]);

    await expect(loadNextGameNumber(supabase, 'season-a', 'M', dayBounds, 'edited-match'))
      .resolves.toEqual({ gameNumber: 1501, error: null });

    const requestUrl = new URL(String(fetch.mock.calls[0]?.[0]));
    expect(requestUrl.searchParams.get('limit')).toBe('1');
    expect(requestUrl.searchParams.get('order')).toBe('game_number.desc.nullslast');
    expect(requestUrl.searchParams.get('season_id')).toBe('eq.season-a');
    expect(requestUrl.searchParams.get('table_mode')).toBe('eq.M');
    expect(requestUrl.searchParams.getAll('played_at')).toEqual([
      `gte.${dayBounds.dayStart}`, `lt.${dayBounds.dayEnd}`
    ]);
    expect(requestUrl.searchParams.get('id')).toBe('neq.edited-match');
  });

  it('starts at one when no numbered match exists', async () => {
    const { supabase } = mockClient([]);
    await expect(loadNextGameNumber(supabase, 'season-a', 'A', dayBounds))
      .resolves.toEqual({ gameNumber: 1, error: null });
  });

  it('rejects PostgreSQL integer overflow', async () => {
    const { supabase } = mockClient([{ game_number: 2_147_483_647 }]);
    await expect(loadNextGameNumber(supabase, 'season-a', 'A', dayBounds))
      .resolves.toEqual({ gameNumber: null, error: 'Could not allocate a valid game number.' });
  });

  it('preserves database errors without allocating a number', async () => {
    const { supabase } = mockClient([], 400);
    await expect(loadNextGameNumber(supabase, 'season-a', 'A', dayBounds))
      .resolves.toEqual({ gameNumber: null, error: 'Database unavailable' });
  });
});
