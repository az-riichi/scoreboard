import type { LayoutServerLoad } from './$types';
import { getActiveSeasonId } from '$lib/server/public-cache';
import { getIsAdmin } from '$lib/server/admin';

export const load: LayoutServerLoad = async ({ locals }) => {
  const user = locals.user;

  const [isAdmin, activeSeasonId] = await Promise.all([
    getIsAdmin(locals),
    getActiveSeasonId(locals.supabase)
  ]);

  return { user, isAdmin, activeSeasonId };
};
