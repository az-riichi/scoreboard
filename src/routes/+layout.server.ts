import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
  const user = locals.user;

  let isAdmin = false;
  if (locals.userId) {
    const { data } = await locals.supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', locals.userId)
      .maybeSingle();
    isAdmin = !!data?.is_admin;
  }

  const { data: active } = await locals.supabase
    .from('seasons')
    .select('id')
    .eq('is_active', true)
    .order('start_date', { ascending: false })
    .limit(1);

  const activeSeasonId = active?.[0]?.id ?? null;

  return { user, isAdmin, activeSeasonId };
};
