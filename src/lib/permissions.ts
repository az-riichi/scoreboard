export const ADMIN_PERMISSION_DEFINITIONS = [
  {
    key: 'add_matches',
    label: 'Add matches',
    description: 'Create match drafts, edit match details and scores, and finalize matches.',
    group: 'Matches'
  },
  {
    key: 'remove_matches',
    label: 'Remove matches',
    description: 'Delete draft or published matches and rebuild affected ratings.',
    group: 'Matches'
  },
  {
    key: 'import_matches',
    label: 'Import matches',
    description: 'Bulk-import complete matches from a spreadsheet.',
    group: 'Matches'
  },
  {
    key: 'manage_match_penalties',
    label: 'Manage match penalties',
    description: 'Add and remove Chombo or other point adjustments attached to a match.',
    group: 'Matches'
  },
  {
    key: 'recompute_ratings',
    label: 'Recompute ratings',
    description: 'Run a full deterministic rebuild of season and lifetime ratings.',
    group: 'Matches'
  },
  {
    key: 'add_players',
    label: 'Add players',
    description: 'Register new players, including players created by a match import.',
    group: 'Players'
  },
  {
    key: 'edit_players',
    label: 'Edit players',
    description: 'Edit player names, profile details, and public display settings.',
    group: 'Players'
  },
  {
    key: 'remove_players',
    label: 'Remove players',
    description: 'Deactivate or reactivate players while preserving their match history.',
    group: 'Players'
  },
  {
    key: 'manage_player_accounts',
    label: 'Manage player accounts',
    description: 'Link and unlink player records from sign-in accounts.',
    group: 'Players'
  },
  {
    key: 'manage_seasons',
    label: 'Manage seasons',
    description: 'Create seasons and choose the active competitive season.',
    group: 'Competition'
  },
  {
    key: 'manage_discipline',
    label: 'Apply/remove disciplinary actions',
    description: 'View the private discipline ledger and issue or revoke strikes, suspensions, and bans.',
    group: 'Competition'
  },
  {
    key: 'manage_permissions',
    label: 'Manage permissions',
    description: 'Grant and revoke granular admin permissions for other accounts.',
    group: 'Administration'
  }
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSION_DEFINITIONS)[number]['key'];
export type AdminRole = 'user' | 'admin' | 'super_admin' | 'owner';

export type AdminAccess = {
  role: AdminRole;
  permissions: AdminPermission[];
  isAdmin: boolean;
  isSuperAdmin: boolean;
  isOwner: boolean;
};

export const ADMIN_PERMISSIONS = ADMIN_PERMISSION_DEFINITIONS.map(
  ({ key }) => key
) as AdminPermission[];

export const MATCH_PERMISSIONS = [
  'add_matches',
  'remove_matches',
  'import_matches',
  'manage_match_penalties',
  'recompute_ratings'
] as const satisfies readonly AdminPermission[];

export const PLAYER_PERMISSIONS = [
  'add_players',
  'edit_players',
  'remove_players',
  'manage_player_accounts'
] as const satisfies readonly AdminPermission[];

const ADMIN_PERMISSION_SET = new Set<string>(ADMIN_PERMISSIONS);
const ADMIN_ROLE_SET = new Set<AdminRole>(['user', 'admin', 'super_admin', 'owner']);

export const NO_ADMIN_ACCESS: AdminAccess = Object.freeze({
  role: 'user',
  permissions: [],
  isAdmin: false,
  isSuperAdmin: false,
  isOwner: false
});

export function normalizeAdminPermissions(value: unknown): AdminPermission[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map((permission) => String(permission ?? '').trim())
        .filter((permission): permission is AdminPermission => ADMIN_PERMISSION_SET.has(permission))
    )
  ];
}

export function createAdminAccess(roleValue: unknown, permissionsValue: unknown): AdminAccess {
  const roleText = String(roleValue ?? '').trim() as AdminRole;
  const role = ADMIN_ROLE_SET.has(roleText) ? roleText : 'user';
  const permissions = role === 'user' ? [] : normalizeAdminPermissions(permissionsValue);
  const isOwner = role === 'owner';
  const isSuperAdmin = isOwner || role === 'super_admin';
  const isAdmin = isSuperAdmin || role === 'admin';

  return { role, permissions, isAdmin, isSuperAdmin, isOwner };
}

export function hasAdminPermission(
  access: AdminAccess | null | undefined,
  permission: AdminPermission
): boolean {
  return !!access && (access.isSuperAdmin || access.permissions.includes(permission));
}

export function hasAnyAdminPermission(
  access: AdminAccess | null | undefined,
  permissions: readonly AdminPermission[]
): boolean {
  return permissions.some((permission) => hasAdminPermission(access, permission));
}
