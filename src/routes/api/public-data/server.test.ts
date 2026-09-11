import { beforeEach, describe, expect, it, vi } from 'vitest';

function database(revisions = ['1']) {
  let revisionRead = 0;
  const tables: Record<string, Record<string, unknown>[]> = {
    seasons: [{ id: 'season' }],
    casual_events: [],
    v_public_players: [{ id: 'player', display_name: 'Public name', real_first_name: null }],
    rulesets: [],
    matches: [{ id: 'final-match', status: 'final' }],
    match_results: [{ match_id: 'final-match', seat: 'E', matches: { status: 'final' } }],
    adjustments: [
      { id: 'season-adjustment', match_id: null },
      { id: 'public-adjustment', match_id: 'final-match' },
      { id: 'draft-adjustment', match_id: 'draft-match' }
    ]
  };
  let pageError: { message: string } | null = null;
  const readPage = vi.fn((table: string, from: number, to: number) =>
    Promise.resolve({ data: tables[table].slice(from, to + 1), error: pageError })
  );
  const readRevision = vi.fn(() => Promise.resolve({
    data: {
      scope: 'scoreboard',
      revision: revisions[Math.min(revisionRead++, revisions.length - 1)],
      changed_at: '2026-07-29T00:00:00Z'
    },
    error: null
  }));
  const from = vi.fn((table: string) => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      order: vi.fn(() => query),
      range: (start: number, end: number) => readPage(table, start, end),
      maybeSingle: readRevision
    };
    return query;
  });
  return {
    locals: { supabase: { from } } as unknown as App.Locals,
    from,
    readPage,
    readRevision,
    tables,
    failPages: (error: { message: string } | null) => { pageError = error; }
  };
}

async function handler() {
  const { GET } = await import('./+server');
  return (db: ReturnType<typeof database>, query = '', headers?: HeadersInit) => {
    const url = new URL(`https://scoreboard.example/api/public-data${query}`);
    return GET({ locals: db.locals, url, request: new Request(url, { headers }) } as never);
  };
}

beforeEach(() => vi.resetModules());

describe('public snapshot endpoint', () => {
  it('checks only the revision for an unchanged client', async () => {
    const get = await handler();
    const db = database();
    const response = await get(db, '?revision=1');

    expect(response.status).toBe(304);
    expect(await response.text()).toBe('');
    expect(response.headers.get('etag')).toBe('"scoreboard-1"');
    expect(db.readRevision).toHaveBeenCalledTimes(1);
    expect(db.readPage).not.toHaveBeenCalled();
  });

  it('accepts a weak ETag without a revision query', async () => {
    const get = await handler();
    const db = database();
    expect((await get(db, '', { 'if-none-match': 'W/"scoreboard-1"' })).status).toBe(304);
    expect(db.readPage).not.toHaveBeenCalled();
  });

  it('reuses the serialized snapshot after a fresh revision check', async () => {
    const get = await handler();
    const db = database();
    const first = await get(db);
    const second = await get(db);

    expect(await second.text()).toBe(await first.text());
    expect(second.headers.get('cache-control')).toBe('private, no-store');
    expect(db.readRevision).toHaveBeenCalledTimes(3);
    expect(db.readPage).toHaveBeenCalledTimes(7);
  });

  it('coalesces simultaneous downloads for the same revision', async () => {
    const get = await handler();
    const db = database();
    const responses = await Promise.all([get(db), get(db), get(db)]);

    expect(await Promise.all(responses.map((response) => response.text())))
      .toEqual([expect.any(String), expect.any(String), expect.any(String)]);
    expect(db.readRevision).toHaveBeenCalledTimes(4);
    expect(db.readPage).toHaveBeenCalledTimes(7);
  });

  it('downloads new data when the revision changes', async () => {
    const get = await handler();
    const db = database(['1', '1', '2', '2']);
    await get(db);
    db.tables.seasons.push({ id: 'new-season' });
    const response = await get(db);

    expect(response.headers.get('x-public-data-revision')).toBe('2');
    expect((await response.json()).seasons).toHaveLength(2);
    expect(db.readPage).toHaveBeenCalledTimes(14);
  });

  it('retries a snapshot whose source data changed during the read', async () => {
    const get = await handler();
    const db = database(['1', '2', '2']);
    const response = await get(db);

    expect((await response.json()).revision.revision).toBe('2');
    expect(db.readPage).toHaveBeenCalledTimes(14);
  });

  it('never caches a mixed snapshot when both read attempts change', async () => {
    const get = await handler();
    const db = database(['1', '2', '3', '3', '3']);
    await expect(get(db)).rejects.toMatchObject({ status: 503 });
    expect((await get(db)).status).toBe(200);
    expect(db.readPage).toHaveBeenCalledTimes(21);
  });

  it('clears a failed in-flight load so a subsequent request can retry', async () => {
    const get = await handler();
    const db = database();
    db.failPages({ message: 'temporarily unavailable' });
    await expect(get(db)).rejects.toMatchObject({ status: 502 });
    db.failPages(null);
    expect((await get(db)).status).toBe(200);
    expect(db.readPage).toHaveBeenCalledTimes(14);
  });

  it('keeps the redacted view, final-match filters, and adjustment publication boundary', async () => {
    const get = await handler();
    const db = database();
    const body = await (await get(db)).json();

    expect(db.from).toHaveBeenCalledWith('v_public_players');
    expect(db.from).not.toHaveBeenCalledWith('players');
    for (const [table, column] of [['matches', 'status'], ['match_results', 'matches.status']]) {
      const call = db.from.mock.calls.findIndex(([name]) => name === table);
      expect(db.from.mock.results[call].value.eq).toHaveBeenCalledWith(column, 'final');
    }
    expect(body.players[0].real_first_name).toBeNull();
    expect(body.match_results[0]).not.toHaveProperty('matches');
    expect(body.adjustments.map((row: { id: string }) => row.id))
      .toEqual(['season-adjustment', 'public-adjustment']);
  });

  it('includes every page when a table exceeds the API page limit', async () => {
    const get = await handler();
    const db = database();
    db.tables.seasons = Array.from({ length: 1_001 }, (_, id) => ({ id: String(id) }));

    expect((await (await get(db)).json()).seasons).toHaveLength(1_001);
    expect(db.readPage).toHaveBeenCalledWith('seasons', 1_000, 1_999);
  });
});
