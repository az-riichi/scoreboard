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

type EventOptions = { method?: string; isDataRequest?: boolean };

function event(routeId: string | null, signedIn: boolean, options: EventOptions = {}) {
  return {
    request: new Request('https://scoreboard.example/', { method: options.method ?? 'GET' }),
    isDataRequest: options.isDataRequest ?? false,
    route: { id: routeId },
    locals: {} as App.Locals,
    cookies: {
      getAll: vi.fn(() => signedIn ? [{ name: 'sb-project-auth-token', value: 'session' }] : []),
      set: vi.fn()
    }
  };
}

function html(status = 200, headers: Record<string, string> = {}) {
  return new Response('<!doctype html>', {
    status,
    headers: { 'content-type': 'text/html', ...headers }
  });
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

  it('still validates the account and forwards cookies for page data', async () => {
    const requestEvent = event('/admin/matches', true, { isDataRequest: true });
    await handle({ event: requestEvent, resolve: vi.fn().mockResolvedValue(new Response()) } as never);

    expect(getUser).toHaveBeenCalledOnce();
    expect(createServerClient.mock.calls[0][2].cookies.getAll())
      .toEqual([{ name: 'sb-project-auth-token', value: 'session' }]);
    expect(requestEvent.locals.userId).toBe('account');
  });

  it.each([
    ['a form action', '/login', { method: 'POST' }],
    ['the session endpoint', '/api/session', {}],
    ['the private profile endpoint', '/api/player-edit-access/[player_id]', {}]
  ])('still validates the account for %s', async (_name, routeId, options) => {
    const requestEvent = event(routeId, true, options);
    await handle({ event: requestEvent, resolve: vi.fn().mockResolvedValue(new Response()) } as never);

    expect(getUser).toHaveBeenCalledOnce();
    expect(requestEvent.locals.userId).toBe('account');
  });

  it('skips account lookups for visitors without an auth cookie', async () => {
    const requestEvent = event('/seasons', false, { isDataRequest: true });
    await handle({ event: requestEvent, resolve: vi.fn().mockResolvedValue(new Response()) } as never);

    expect(getUser).not.toHaveBeenCalled();
    expect(requestEvent.locals.userId).toBeNull();
  });
});

describe('app shell caching', () => {
  it('serves page documents without touching the session and lets the CDN keep them', async () => {
    const requestEvent = event('/admin/matches', true);
    const response = await handle({
      event: requestEvent,
      resolve: vi.fn().mockResolvedValue(html())
    } as never);

    expect(getUser).not.toHaveBeenCalled();
    expect(requestEvent.cookies.getAll).not.toHaveBeenCalled();
    expect(createServerClient.mock.calls[0][2].cookies.getAll()).toEqual([]);
    expect(response.headers.get('netlify-cdn-cache-control')).toContain('s-maxage');
  });

  it.each([
    ['page data', '/seasons', { isDataRequest: true }, html()],
    ['a form result', '/login', { method: 'POST' }, html()],
    ['an endpoint', '/api/session', {}, new Response('{}', { headers: { 'content-type': 'application/json' } })],
    ['an unknown address', null, {}, html()],
    ['an error page', '/season/[season_id]', {}, html(500)],
    ['a redirect', '/login', {}, new Response(null, { status: 303, headers: { location: '/' } })],
    ['a response setting a cookie', '/seasons', {}, html(200, { 'set-cookie': 'a=b' })]
  ])('never lets the CDN keep %s', async (_name, routeId, options, resolved) => {
    const response = await handle({
      event: event(routeId, false, options),
      resolve: vi.fn().mockResolvedValue(resolved)
    } as never);

    expect(response.headers.has('netlify-cdn-cache-control')).toBe(false);
  });
});
