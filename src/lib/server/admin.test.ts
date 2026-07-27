import { describe, expect, it } from 'vitest';
import {
  getAdminAccess,
  requireAdminPermission,
  requireAnyAdminPermission
} from './admin';

function createLocals(
  row: Record<string, unknown> | null,
  queryError: { message: string } | null = null,
  signedIn = true
) {
  let profileQueries = 0;
  const query = {
    select() {
      return query;
    },
    eq() {
      return query;
    },
    async maybeSingle() {
      return { data: row, error: queryError };
    }
  };

  const locals = {
    user: signedIn ? { id: '00000000-0000-4000-8000-000000000001' } : null,
    userId: signedIn ? '00000000-0000-4000-8000-000000000001' : null,
    supabase: {
      from(table: string) {
        if (table === 'profiles') profileQueries += 1;
        return query;
      }
    }
  } as unknown as App.Locals;

  return { locals, getProfileQueries: () => profileQueries };
}

describe('server admin authorization', () => {
  it('loads and caches a granular access snapshot per request', async () => {
    const request = createLocals({
      admin_role: 'admin',
      admin_permissions: ['add_matches']
    });

    const first = await getAdminAccess(request.locals);
    const second = await getAdminAccess(request.locals);

    expect(first).toEqual(second);
    expect(first.permissions).toEqual(['add_matches']);
    expect(request.getProfileQueries()).toBe(1);
  });

  it('fails closed when the profile lookup fails', async () => {
    const request = createLocals(null, { message: 'database unavailable' });

    await expect(getAdminAccess(request.locals)).resolves.toMatchObject({
      role: 'user',
      isAdmin: false
    });
  });

  it('rejects an adjacent permission without running privileged work', async () => {
    const request = createLocals({
      admin_role: 'admin',
      admin_permissions: ['add_players']
    });

    await expect(
      requireAdminPermission(request.locals, 'remove_players')
    ).rejects.toMatchObject({ status: 403 });
  });

  it('allows any-of checks and sends signed-out users to login', async () => {
    const request = createLocals({
      admin_role: 'admin',
      admin_permissions: ['manage_match_penalties']
    });
    await expect(
      requireAnyAdminPermission(request.locals, ['add_matches', 'manage_match_penalties'])
    ).resolves.toMatchObject({ role: 'admin' });

    const signedOut = createLocals(null, null, false);
    await expect(
      requireAdminPermission(signedOut.locals, 'add_matches')
    ).rejects.toMatchObject({
      status: 303,
      location: '/login'
    });
  });
});
