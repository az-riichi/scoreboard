import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const { data, error } = await locals.supabase
    .from('seasons')
    .select('id, name, start_date, end_date, is_active')
    .order('start_date', { ascending: false });

  return { seasons: error ? [] : (data ?? []) };
};
