import { error as kitError } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
  const match_id = params.match_id;

  const matchRes = await locals.supabase
    .from('matches')
    .select('id, season_id, ruleset_id, played_at, table_label, notes, status, game_number, table_mode, extra_sticks')
    .eq('id', match_id)
    .maybeSingle();

  if (matchRes.error || !matchRes.data) throw kitError(404, 'Match not found');
  if (matchRes.data.status !== 'final') throw kitError(404, 'Match not public');

  const resultsRes = await locals.supabase
    .from('v_final_results')
    .select('*')
    .eq('match_id', match_id);

  const deltasRes = await locals.supabase
    .from('v_rating_history')
    .select('player_id, display_name, delta, new_rate, placement, is_lifetime')
    .eq('match_id', match_id)
    .eq('is_lifetime', false);

  return {
    match: matchRes.data,
    results: resultsRes.error ? [] : (resultsRes.data ?? []),
    ratingDeltas: deltasRes.error ? [] : (deltasRes.data ?? [])
  };
};
