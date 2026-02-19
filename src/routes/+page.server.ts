import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const { data } = await locals.supabase
    .from('seasons')
    .select('id')
    .eq('is_active', true)
    .order('start_date', { ascending: false })
    .limit(1);

  const activeId = data?.[0]?.id ?? null;
  throw redirect(303, activeId ? `/season/${activeId}` : '/seasons');
};
