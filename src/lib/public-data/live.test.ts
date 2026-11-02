import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startPublicDataUpdates } from './live';
import type { PublicDataSnapshot } from './types';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getPublicSnapshot: vi.fn(),
  onPublicDataRevision: vi.fn()
}));

vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));
vi.mock('$env/static/public', () => ({
  PUBLIC_SUPABASE_URL: 'https://scoreboard.example',
  PUBLIC_SUPABASE_ANON_KEY: 'public-anon-key'
}));
vi.mock('./cache', () => ({
  getPublicSnapshot: mocks.getPublicSnapshot,
  onPublicDataRevision: mocks.onPublicDataRevision
}));

function snapshot(revision: string): PublicDataSnapshot {
  return {
    schema_version: 1,
    revision: { scope: 'scoreboard', revision, changed_at: '2026-09-11T00:00:00Z' },
    seasons: [],
    casual_events: [],
    players: [],
    rulesets: [],
    matches: [],
    match_results: [],
    adjustments: []
  };
}

function deferredSnapshot() {
  let resolve!: (value: PublicDataSnapshot) => void;
  const promise = new Promise<PublicDataSnapshot>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe('automatic public data updates', () => {
  let pageDocument: EventTarget & { visibilityState: string };
  let pageWindow: EventTarget;
  let pageNavigator: { onLine: boolean };
  let displayedRevision: string;
  let realtimeRevision: (payload: { new: { revision: unknown } }) => void;
  let subscriptionStatus: (status: string) => void;
  let otherTabRevision: (revision: string) => void;
  let stop: (() => void) | undefined;
  const refreshPage = vi.fn<() => Promise<void>>();
  const stopOtherTabs = vi.fn();
  const removeChannel = vi.fn();
  const disposeAuth = vi.fn();
  const channel = { on: vi.fn(), subscribe: vi.fn() };

  function publish(revision: unknown) {
    realtimeRevision({ new: { revision } });
  }

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    pageDocument = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    pageWindow = new EventTarget();
    pageNavigator = { onLine: true };
    vi.stubGlobal('document', pageDocument);
    vi.stubGlobal('window', pageWindow);
    vi.stubGlobal('navigator', pageNavigator);
    displayedRevision = '1';

    channel.on.mockImplementation((_event, _filter, callback) => {
      realtimeRevision = callback;
      return channel;
    });
    channel.subscribe.mockImplementation((callback) => {
      subscriptionStatus = callback;
      return channel;
    });
    mocks.createClient.mockReturnValue({
      channel: vi.fn(() => channel),
      removeChannel,
      auth: { dispose: disposeAuth }
    });
    mocks.onPublicDataRevision.mockImplementation((callback) => {
      otherTabRevision = callback;
      return stopOtherTabs;
    });
    mocks.getPublicSnapshot.mockResolvedValue(snapshot('1'));
    refreshPage.mockResolvedValue(undefined);
    removeChannel.mockResolvedValue('ok');
    disposeAuth.mockResolvedValue(undefined);
    stop = startPublicDataUpdates(() => displayedRevision, refreshPage);
  });

  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('checks on subscription and reconnect without rerendering unchanged data', async () => {
    expect(channel.on).toHaveBeenCalledWith(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'public_data_revision',
        filter: 'scope=eq.scoreboard'
      },
      expect.any(Function)
    );

    subscriptionStatus('SUBSCRIBED');
    await vi.advanceTimersByTimeAsync(250);
    expect(mocks.getPublicSnapshot).toHaveBeenCalledTimes(1);
    expect(refreshPage).not.toHaveBeenCalled();

    mocks.getPublicSnapshot.mockResolvedValue(snapshot('2'));
    subscriptionStatus('CHANNEL_ERROR');
    subscriptionStatus('SUBSCRIBED');
    await vi.advanceTimersByTimeAsync(250);
    expect(mocks.getPublicSnapshot).toHaveBeenCalledTimes(2);
    expect(refreshPage).toHaveBeenCalledTimes(1);
  });

  it('coalesces a burst of publications and other-tab updates into one refresh', async () => {
    mocks.getPublicSnapshot.mockResolvedValue(snapshot('4'));
    publish('2');
    publish('3');
    publish('3');
    otherTabRevision('4');
    await vi.advanceTimersByTimeAsync(249);
    expect(mocks.getPublicSnapshot).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.getPublicSnapshot).toHaveBeenCalledTimes(1);
    expect(refreshPage).toHaveBeenCalledTimes(1);

    displayedRevision = '4';
    publish('4');
    otherTabRevision('3');
    await vi.advanceTimersByTimeAsync(250);
    expect(mocks.getPublicSnapshot).toHaveBeenCalledTimes(1);
  });

  it('ignores invalid and old revisions while preserving bigint precision', async () => {
    for (const revision of [undefined, null, '', 'invalid', '-1', '1.5', '0', '1']) {
      publish(revision);
    }
    otherTabRevision('invalid');
    await vi.advanceTimersByTimeAsync(250);
    expect(mocks.getPublicSnapshot).not.toHaveBeenCalled();

    displayedRevision = '9007199254740992';
    mocks.getPublicSnapshot.mockResolvedValue(snapshot('9007199254740993'));
    publish('9007199254740993');
    await vi.advanceTimersByTimeAsync(250);
    expect(mocks.getPublicSnapshot).toHaveBeenCalledTimes(1);
    expect(refreshPage).toHaveBeenCalledTimes(1);
  });

  it('checks again when a publication arrives while an older request is in flight', async () => {
    const olderRequest = deferredSnapshot();
    mocks.getPublicSnapshot
      .mockReturnValueOnce(olderRequest.promise)
      .mockResolvedValueOnce(snapshot('3'));
    subscriptionStatus('SUBSCRIBED');
    await vi.advanceTimersByTimeAsync(250);
    expect(mocks.getPublicSnapshot).toHaveBeenCalledTimes(1);

    publish('2');
    otherTabRevision('3');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mocks.getPublicSnapshot).toHaveBeenCalledTimes(1);

    olderRequest.resolve(snapshot('1'));
    await vi.advanceTimersByTimeAsync(0);
    expect(refreshPage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    expect(mocks.getPublicSnapshot).toHaveBeenCalledTimes(2);
    expect(refreshPage).toHaveBeenCalledTimes(1);
  });

  it('catches up when a hidden tab becomes visible and an offline tab reconnects', async () => {
    pageDocument.visibilityState = 'hidden';
    mocks.getPublicSnapshot.mockResolvedValue(snapshot('2'));
    publish('2');
    subscriptionStatus('SUBSCRIBED');
    await vi.advanceTimersByTimeAsync(60_250);
    expect(mocks.getPublicSnapshot).not.toHaveBeenCalled();

    pageDocument.visibilityState = 'visible';
    pageDocument.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(250);
    expect(mocks.getPublicSnapshot).toHaveBeenCalledTimes(1);
    expect(refreshPage).toHaveBeenCalledTimes(1);

    displayedRevision = '2';
    pageNavigator.onLine = false;
    mocks.getPublicSnapshot.mockResolvedValue(snapshot('3'));
    publish('3');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.getPublicSnapshot).toHaveBeenCalledTimes(1);

    pageNavigator.onLine = true;
    pageWindow.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(250);
    expect(mocks.getPublicSnapshot).toHaveBeenCalledTimes(2);
    expect(refreshPage).toHaveBeenCalledTimes(2);
  });

  it('uses periodic checks to recover after a failed refresh without a realtime connection', async () => {
    mocks.getPublicSnapshot
      .mockRejectedValueOnce(new Error('Network unavailable'))
      .mockResolvedValueOnce(snapshot('2'));
    subscriptionStatus('CHANNEL_ERROR');
    await vi.advanceTimersByTimeAsync(60_250);
    expect(mocks.getPublicSnapshot).toHaveBeenCalledTimes(1);
    expect(refreshPage).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.getPublicSnapshot).toHaveBeenCalledTimes(2);
    expect(refreshPage).toHaveBeenCalledTimes(1);
  });

  it('retries a failed page refresh on a later update', async () => {
    mocks.getPublicSnapshot.mockResolvedValue(snapshot('2'));
    refreshPage.mockRejectedValueOnce(new Error('Navigation interrupted'));
    publish('2');
    await vi.advanceTimersByTimeAsync(250);
    expect(refreshPage).toHaveBeenCalledTimes(1);

    otherTabRevision('2');
    await vi.advanceTimersByTimeAsync(250);
    expect(mocks.getPublicSnapshot).toHaveBeenCalledTimes(2);
    expect(refreshPage).toHaveBeenCalledTimes(2);
  });

  it('cleans up pending work, subscriptions, and browser listeners on unmount', async () => {
    const documentRemove = vi.spyOn(pageDocument, 'removeEventListener');
    const windowRemove = vi.spyOn(pageWindow, 'removeEventListener');
    publish('2');
    stop?.();
    stop = undefined;

    expect(stopOtherTabs).toHaveBeenCalledTimes(1);
    expect(removeChannel).toHaveBeenCalledWith(channel);
    expect(disposeAuth).toHaveBeenCalledTimes(1);
    expect(documentRemove).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(windowRemove).toHaveBeenCalledWith('online', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);

    publish('3');
    otherTabRevision('3');
    subscriptionStatus('SUBSCRIBED');
    pageDocument.dispatchEvent(new Event('visibilitychange'));
    pageWindow.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(mocks.getPublicSnapshot).not.toHaveBeenCalled();
    expect(refreshPage).not.toHaveBeenCalled();
  });

  it('does not update an unmounted page when an in-flight request completes', async () => {
    const request = deferredSnapshot();
    mocks.getPublicSnapshot.mockReturnValueOnce(request.promise);
    publish('2');
    await vi.advanceTimersByTimeAsync(250);
    publish('3');
    stop?.();
    stop = undefined;

    request.resolve(snapshot('2'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mocks.getPublicSnapshot).toHaveBeenCalledTimes(1);
    expect(refreshPage).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
