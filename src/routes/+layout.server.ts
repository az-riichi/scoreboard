import type { LayoutServerLoad } from './$types';
import { getActiveSeasonId } from '$lib/server/public-cache';
import { getAdminAccess } from '$lib/server/admin';

export const load: LayoutServerLoad = async ({ locals }) => {
  const user = locals.user;

  const [adminAccess, activeSeasonId] = await Promise.all([
    getAdminAccess(locals),
    getActiveSeasonId(locals.supabase)
  ]);

  return { user, isAdmin: adminAccess.isAdmin, adminAccess, activeSeasonId };
};
