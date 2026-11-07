import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));

function browserWith(cookie: string, stored: Record<string, string> = {}) {
  const storage = new Map(Object.entries(stored));
  vi.stubGlobal('document', { cookie });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key)
  });
  return storage;
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('session shown in the header', () => {
  it('never asks the server about a visitor without an auth cookie', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const storage = browserWith('theme=dark', { 'azrm-show-admin-link': '1' });
    const { confirmSession, session } = await import('./session');

    expect(get(session)).toEqual({ signedIn: false, isAdmin: false });
    await confirmSession();
    expect(fetch).not.toHaveBeenCalled();
    expect(storage.size).toBe(0);
  });

  it.each(['sb-project-auth-token=abc', 'theme=dark; sb-project-auth-token.0=abc'])(
    'treats %s as signed in before the server answers',
    async (cookie) => {
      browserWith(cookie);
      const { session } = await import('./session');
      expect(get(session)).toEqual({ signedIn: true, isAdmin: false });
    }
  );

  it('shows the admin link from the last confirmed visit', async () => {
    browserWith('sb-project-auth-token=abc', { 'azrm-show-admin-link': '1' });
    const { session } = await import('./session');
    expect(get(session)).toEqual({ signedIn: true, isAdmin: true });
  });

  it('remembers what the server confirms', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ signedIn: true, isAdmin: true })));
    const storage = browserWith('sb-project-auth-token=abc');
    const { confirmSession, session } = await import('./session');

    await confirmSession();
    expect(get(session)).toEqual({ signedIn: true, isAdmin: true });
    expect(storage.get('azrm-show-admin-link')).toBe('1');
  });

  it('corrects the header when the session has ended or access was removed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ signedIn: false, isAdmin: false })));
    const storage = browserWith('sb-project-auth-token=old', { 'azrm-show-admin-link': '1' });
    const { confirmSession, session } = await import('./session');

    await confirmSession();
    expect(get(session)).toEqual({ signedIn: false, isAdmin: false });
    expect(storage.has('azrm-show-admin-link')).toBe(false);
  });

  it.each([
    ['a failed request', () => Promise.reject(new TypeError('Offline'))],
    ['a server error', () => Promise.resolve(new Response(null, { status: 502 }))]
  ])('keeps the header as it is after %s', async (_name, answer) => {
    vi.stubGlobal('fetch', vi.fn(answer));
    browserWith('sb-project-auth-token=abc', { 'azrm-show-admin-link': '1' });
    const { confirmSession, session } = await import('./session');

    await confirmSession();
    expect(get(session)).toEqual({ signedIn: true, isAdmin: true });
  });
});
