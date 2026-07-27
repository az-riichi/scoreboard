import type { PageServerLoad } from './$types';
import { requireAdmin } from '$lib/server/admin';
import { hasAdminPermission } from '$lib/permissions';

export const load: PageServerLoad = async ({ locals }) => {
  const adminAccess = await requireAdmin(locals);

  if (!hasAdminPermission(adminAccess, 'add_matches')) return { drafts: [] };

  const draftsRes = await locals.supabase
    .from('matches')
    .select('id, played_at, table_label, season_id, status')
    .eq('status', 'draft')
    .order('played_at', { ascending: false })
    .limit(20);
  return { drafts: draftsRes.error ? [] : (draftsRes.data ?? []) };
};
