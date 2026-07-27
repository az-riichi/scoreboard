import type { LayoutServerLoad } from './$types';
import { getAdminAccess } from '$lib/server/admin';

export const load: LayoutServerLoad = async ({ locals }) => {
  const user = locals.user;
  const adminAccess = await getAdminAccess(locals);
  // The universal layout replaces this without a database read after it
  // synchronizes the browser snapshot. Keeping the key in server parent data
  // also lets nested server loads inherit a stable shape.
  return { user, isAdmin: adminAccess.isAdmin, adminAccess, activeSeasonId: null };
};
