import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ goto: vi.fn(), getPublicSnapshot: vi.fn() }));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$lib/public-data/cache', () => ({ getPublicSnapshot: mocks.getPublicSnapshot }));

import { load } from './+page';

function checkedSnapshot(activeSeasonId: string | null) {
  return {
    seasons: activeSeasonId ? [{ id: activeSeasonId, is_active: true, is_casual: false }] : []
  };
}

async function landOn(activeSeasonId: string | null, pathnameAfterRedirect: string) {
  vi.stubGlobal('location', { pathname: pathnameAfterRedirect });
  const redirect = await (load as (event: unknown) => Promise<unknown>)({
    parent: async () => ({ activeSeasonId })
  }).catch((thrown: unknown) => thrown);
  await vi.waitFor(() => expect(mocks.getPublicSnapshot).toHaveBeenCalledOnce());
  await new Promise((resolve) => setTimeout(resolve));
  return redirect;
}

beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('home page redirect', () => {
  it('sends the visitor straight to the active season without waiting for the check', async () => {
    mocks.getPublicSnapshot.mockReturnValue(new Promise(() => {}));
    expect(await landOn('spring', '/season/spring')).toMatchObject({
      status: 303,
      location: '/season/spring'
    });
    expect(mocks.goto).not.toHaveBeenCalled();
  });

  it('stays put when the check agrees', async () => {
    mocks.getPublicSnapshot.mockResolvedValue(checkedSnapshot('spring'));
    await landOn('spring', '/season/spring');
    expect(mocks.goto).not.toHaveBeenCalled();
  });

  it('moves on to a season that started since the stored copy was made', async () => {
    mocks.getPublicSnapshot.mockResolvedValue(checkedSnapshot('summer'));
    await landOn('spring', '/season/spring');
    expect(mocks.goto).toHaveBeenCalledWith('/season/summer', { replaceState: true });
  });

  it('leaves a visitor alone once they have gone somewhere else', async () => {
    mocks.getPublicSnapshot.mockResolvedValue(checkedSnapshot('summer'));
    await landOn('spring', '/hall-of-fame');
    expect(mocks.goto).not.toHaveBeenCalled();
  });

  it('keeps the visitor where they are when the check fails', async () => {
    mocks.getPublicSnapshot.mockRejectedValue(new TypeError('Offline'));
    await landOn('spring', '/season/spring');
    expect(mocks.goto).not.toHaveBeenCalled();
  });

  it('falls back to the seasons list when no season is active', async () => {
    mocks.getPublicSnapshot.mockResolvedValue(checkedSnapshot(null));
    expect(await landOn(null, '/seasons')).toMatchObject({ location: '/seasons' });
  });
});
