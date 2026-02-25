import type { LayoutServerLoad } from './$types';
import { getActiveSeasonId } from '$lib/server/public-cache';

export const load: LayoutServerLoad = async ({ locals }) => {
  const user = locals.user;

  const [adminRes, activeSeasonId] = await Promise.all([
    locals.userId
      ? locals.supabase.from('profiles').select('is_admin').eq('id', locals.userId).maybeSingle()
      : Promise.resolve<{ data: { is_admin?: boolean } | null }>({ data: null }),
    getActiveSeasonId(locals.supabase)
  ]);

  const isAdmin = !!adminRes.data?.is_admin;

  return { user, isAdmin, activeSeasonId };
};
