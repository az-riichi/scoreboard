import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicDataSnapshot } from './types';

vi.mock('$app/environment', () => ({ browser: true }));

function snapshot(revision: string): PublicDataSnapshot {
  return {
    schema_version: 1,
    revision: { scope: 'scoreboard', revision, changed_at: '2026-07-29T00:00:00Z' },
    seasons: [], casual_events: [], players: [], rulesets: [], matches: [],
    match_results: [], adjustments: []
  };
}

class TestBroadcastChannel {
  static channels: TestBroadcastChannel[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  postMessage = vi.fn();
  close = vi.fn();
  constructor() {
    TestBroadcastChannel.channels.push(this);
  }
}

describe('public snapshot refresh', () => {
  beforeEach(() => {
    vi.resetModules();
    TestBroadcastChannel.channels = [];
    vi.stubGlobal('indexedDB', undefined);
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('BroadcastChannel', TestBroadcastChannel);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('checks on first route load and reuses the refreshed snapshot without another request', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json(snapshot('1')))
      .mockResolvedValueOnce(Response.json(snapshot('2')));
    vi.stubGlobal('fetch', fetch);
    const { getPublicSnapshot } = await import('./cache');

    expect((await getPublicSnapshot({ check: false })).revision.revision).toBe('1');
    await getPublicSnapshot({ check: false });
    expect(fetch).toHaveBeenCalledTimes(1);

    const refreshed = await getPublicSnapshot();
    expect(refreshed.revision.revision).toBe('2');
    expect(await getPublicSnapshot({ check: false })).toBe(refreshed);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0]).toBe('/api/public-data?revision=1');
    expect(fetch.mock.calls[1][1].headers.get('if-none-match')).toBe('"scoreboard-1"');
  });

  it('keeps the same snapshot after an unchanged revision response', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json(snapshot('1')))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    vi.stubGlobal('fetch', fetch);
    const { getPublicSnapshot } = await import('./cache');
    const previous = await getPublicSnapshot();

    expect(await getPublicSnapshot()).toBe(previous);
  });

  it('shares an in-flight check between callers', async () => {
    let resolveFetch!: (response: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve; }));
    vi.stubGlobal('fetch', fetch);
    const { getPublicSnapshot } = await import('./cache');
    const first = getPublicSnapshot();
    const second = getPublicSnapshot({ check: false });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    resolveFetch(Response.json(snapshot('1')));

    expect(await first).toBe(await second);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('retains offline data after a cross-tab update and recovers on the next check', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json(snapshot('1')))
      .mockRejectedValueOnce(new TypeError('Offline'))
      .mockResolvedValueOnce(Response.json(snapshot('2')));
    vi.stubGlobal('fetch', fetch);
    const { getPublicSnapshot, onPublicDataRevision } = await import('./cache');
    const previous = await getPublicSnapshot();
    const notify = vi.fn();
    const stop = onPublicDataRevision(notify);
    const channel = TestBroadcastChannel.channels[0];

    channel.onmessage?.({ data: { revision: 'invalid' } });
    expect(notify).not.toHaveBeenCalled();
    channel.onmessage?.({ data: { revision: '2' } });
    expect(notify).toHaveBeenCalledWith('2');
    expect(await getPublicSnapshot({ check: false })).toBe(previous);
    expect(await getPublicSnapshot()).toBe(previous);
    expect((await getPublicSnapshot()).revision.revision).toBe('2');

    stop();
    expect(channel.close).toHaveBeenCalledOnce();
  });

  it('does not replace usable data with an incomplete response', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json(snapshot('1')))
      .mockResolvedValueOnce(Response.json({ schema_version: 1, revision: { revision: '2' } }));
    vi.stubGlobal('fetch', fetch);
    const { getPublicSnapshot } = await import('./cache');
    const previous = await getPublicSnapshot();

    expect(await getPublicSnapshot()).toBe(previous);
    expect(await getPublicSnapshot({ check: false })).toBe(previous);
  });
});
