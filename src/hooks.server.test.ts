import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createServerClient, getUser } = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getUser: vi.fn()
}));

vi.mock('@supabase/ssr', () => ({ createServerClient }));
vi.mock('$env/static/public', () => ({
  PUBLIC_SUPABASE_URL: 'https://database.example',
  PUBLIC_SUPABASE_ANON_KEY: 'public-key'
}));

import { handle } from './hooks.server';

function event(routeId: string, signedIn: boolean) {
  return {
    route: { id: routeId },
    locals: {} as App.Locals,
    cookies: {
      getAll: vi.fn(() => signedIn ? [{ name: 'sb-project-auth-token', value: 'session' }] : []),
      set: vi.fn()
    }
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: 'account' } }, error: null });
  createServerClient.mockReturnValue({ auth: { getUser } });
});

describe('request authentication', () => {
  it('reads public snapshots anonymously without looking up the signed-in account', async () => {
    const requestEvent = event('/api/public-data', true);
    const resolve = vi.fn().mockResolvedValue(new Response('public data'));
    await handle({ event: requestEvent, resolve } as never);

    expect(getUser).not.toHaveBeenCalled();
    expect(requestEvent.cookies.getAll).not.toHaveBeenCalled();
    expect(createServerClient.mock.calls[0][2].cookies.getAll()).toEqual([]);
    expect(requestEvent.locals.user).toBeNull();
    expect(requestEvent.locals.userId).toBeNull();
    expect(resolve).toHaveBeenCalledOnce();
  });

  it('still validates the account and forwards cookies for authenticated routes', async () => {
    const requestEvent = event('/admin/matches', true);
    await handle({ event: requestEvent, resolve: vi.fn().mockResolvedValue(new Response()) } as never);

    expect(getUser).toHaveBeenCalledOnce();
    expect(createServerClient.mock.calls[0][2].cookies.getAll())
      .toEqual([{ name: 'sb-project-auth-token', value: 'session' }]);
    expect(requestEvent.locals.userId).toBe('account');
  });

  it('skips account lookups for visitors without an auth cookie', async () => {
    const requestEvent = event('/seasons', false);
    await handle({ event: requestEvent, resolve: vi.fn().mockResolvedValue(new Response()) } as never);

    expect(getUser).not.toHaveBeenCalled();
    expect(requestEvent.locals.userId).toBeNull();
  });
});
