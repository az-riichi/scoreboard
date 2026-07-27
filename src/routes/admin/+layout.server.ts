import type { LayoutServerLoad } from './$types';
import { requireAdmin } from '$lib/server/admin';

export const load: LayoutServerLoad = async ({ locals }) => {
  const adminAccess = await requireAdmin(locals);
  return { adminAccess };
};
