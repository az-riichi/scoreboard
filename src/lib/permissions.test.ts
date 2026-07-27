import { describe, expect, it } from 'vitest';
import {
  createAdminAccess,
  hasAdminPermission,
  hasAnyAdminPermission,
  normalizeAdminPermissions
} from './permissions';

describe('admin permissions', () => {
  it('normalizes known permissions and removes duplicates', () => {
    expect(
      normalizeAdminPermissions(['add_matches', 'unknown', 'add_matches', null, 'remove_players'])
    ).toEqual(['add_matches', 'remove_players']);
  });

  it('keeps granular admins limited to assigned permissions', () => {
    const access = createAdminAccess('admin', ['add_matches']);

    expect(access.isAdmin).toBe(true);
    expect(access.isSuperAdmin).toBe(false);
    expect(hasAdminPermission(access, 'add_matches')).toBe(true);
    expect(hasAdminPermission(access, 'remove_matches')).toBe(false);
  });

  it('gives super admins and owners every granular permission', () => {
    const superAdmin = createAdminAccess('super_admin', []);
    const owner = createAdminAccess('owner', []);

    expect(hasAdminPermission(superAdmin, 'manage_permissions')).toBe(true);
    expect(hasAdminPermission(owner, 'remove_matches')).toBe(true);
    expect(owner.isOwner).toBe(true);
    expect(owner.isSuperAdmin).toBe(true);
  });

  it('supports section-level any-permission checks', () => {
    const access = createAdminAccess('admin', ['remove_players']);

    expect(hasAnyAdminPermission(access, ['add_players', 'remove_players'])).toBe(true);
    expect(hasAnyAdminPermission(access, ['add_matches', 'remove_matches'])).toBe(false);
  });

  it('fails closed when a user or unknown role carries stray permission data', () => {
    const user = createAdminAccess('user', ['manage_permissions']);
    const unknown = createAdminAccess('root', ['remove_matches']);

    expect(user).toEqual({
      role: 'user',
      permissions: [],
      isAdmin: false,
      isSuperAdmin: false,
      isOwner: false
    });
    expect(hasAdminPermission(unknown, 'remove_matches')).toBe(false);
  });
});
