import { error as kitError } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
  const season_id = params.season_id;

  const seasonRes = await locals.supabase
    .from('seasons')
    .select('id, name, start_date, end_date, is_active')
    .eq('id', season_id)
    .maybeSingle();

  if (seasonRes.error || !seasonRes.data) throw kitError(404, 'Season not found');

  const standingsRes = await locals.supabase
    .from('v_season_standings')
    .select('*')
    .eq('season_id', season_id)
    .order('rank', { ascending: true });

  const matchesRes = await locals.supabase
    .from('matches')
    .select('id, played_at, table_label')
    .eq('season_id', season_id)
    .eq('status', 'final')
    .order('played_at', { ascending: false })
    .limit(25);

  return {
    season: seasonRes.data,
    standings: standingsRes.error ? [] : (standingsRes.data ?? []),
    recentMatches: matchesRes.error ? [] : (matchesRes.data ?? [])
  };
};
