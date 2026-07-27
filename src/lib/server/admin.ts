import { error, redirect } from '@sveltejs/kit';
import {
  createAdminAccess,
  hasAdminPermission,
  hasAnyAdminPermission,
  NO_ADMIN_ACCESS,
  type AdminAccess,
  type AdminPermission
} from '$lib/permissions';

const adminLookupByRequest = new WeakMap<App.Locals, Promise<AdminAccess>>();

export function getAdminAccess(locals: App.Locals): Promise<AdminAccess> {
  if (!locals.user || !locals.userId) return Promise.resolve(NO_ADMIN_ACCESS);

  const existing = adminLookupByRequest.get(locals);
  if (existing) return existing;

  const lookup = (async () => {
    const { data, error } = await locals.supabase
      .from('profiles')
      .select('admin_role, admin_permissions')
      .eq('id', locals.userId)
      .maybeSingle();
    if (error || !data) return NO_ADMIN_ACCESS;
    return createAdminAccess(data.admin_role, data.admin_permissions);
  })();
  adminLookupByRequest.set(locals, lookup);
  return lookup;
}

export async function getIsAdmin(locals: App.Locals): Promise<boolean> {
  return (await getAdminAccess(locals)).isAdmin;
}

function requireSignedIn(locals: App.Locals) {
  if (!locals.user || !locals.userId) throw redirect(303, '/login');
}

export async function requireAdmin(locals: App.Locals): Promise<AdminAccess> {
  requireSignedIn(locals);
  const access = await getAdminAccess(locals);
  if (!access.isAdmin) throw redirect(303, '/');
  return access;
}

export async function requireAdminPermission(
  locals: App.Locals,
  permission: AdminPermission
): Promise<AdminAccess> {
  requireSignedIn(locals);
  const access = await getAdminAccess(locals);
  if (!hasAdminPermission(access, permission)) {
    throw error(403, 'You do not have permission to use this admin tool.');
  }
  return access;
}

export async function requireAnyAdminPermission(
  locals: App.Locals,
  permissions: readonly AdminPermission[]
): Promise<AdminAccess> {
  requireSignedIn(locals);
  const access = await getAdminAccess(locals);
  if (!hasAnyAdminPermission(access, permissions)) {
    throw error(403, 'You do not have permission to use this admin tool.');
  }
  return access;
}
