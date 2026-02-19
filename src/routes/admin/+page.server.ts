import type { PageServerLoad } from './$types';
import { requireAdmin } from '$lib/server/admin';

export const load: PageServerLoad = async ({ locals }) => {
  await requireAdmin(locals);

  const draftsRes = await locals.supabase
    .from('matches')
    .select('id, played_at, table_label, season_id, status')
    .eq('status', 'draft')
    .order('played_at', { ascending: false })
    .limit(20);

  return { drafts: draftsRes.error ? [] : (draftsRes.data ?? []) };
};
