import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const { data, error } = await locals.supabase
    .from('seasons')
    .select('id, name, start_date, end_date, is_active, is_casual')
    .order('is_casual', { ascending: false })
    .order('start_date', { ascending: false, nullsFirst: false });

  return { seasons: error ? [] : (data ?? []) };
};
