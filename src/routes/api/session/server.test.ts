import { describe, expect, it, vi } from 'vitest';
import { GET } from './+server';

function adminRead(role: string | null) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({
      data: role ? { admin_role: role, admin_permissions: [] } : null,
      error: null
    }))
  };
  return { from: vi.fn(() => query) };
}

function get(locals: Partial<App.Locals>) {
  return GET({ locals } as never) as Promise<Response>;
}

describe('session endpoint', () => {
  it('reports a signed-out visitor without reading the database', async () => {
    const supabase = adminRead('super_admin');
    const response = await get({ user: null, userId: null, supabase: supabase as never });

    expect(await response.json()).toEqual({ signedIn: false, isAdmin: false });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('reports an administrator and is never stored by a shared cache', async () => {
    const response = await get({
      user: { id: 'account' } as never,
      userId: 'account',
      supabase: adminRead('super_admin') as never
    });

    expect(await response.json()).toEqual({ signedIn: true, isAdmin: true });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('reports a member who is not an administrator', async () => {
    const response = await get({
      user: { id: 'account' } as never,
      userId: 'account',
      supabase: adminRead(null) as never
    });

    expect(await response.json()).toEqual({ signedIn: true, isAdmin: false });
  });
});
