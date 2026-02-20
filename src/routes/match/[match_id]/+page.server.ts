import { error as kitError } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { composeSeasonNameParts } from '$lib/player-name';

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
    .eq('is_lifetime', true);

  const results = resultsRes.error ? [] : (resultsRes.data ?? []);
  const ratingDeltas = deltasRes.error ? [] : (deltasRes.data ?? []);

  const playerIds = Array.from(
    new Set(
      [...results, ...ratingDeltas]
        .map((row: any) => row.player_id)
        .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
    )
  );

  let playerLabelById = new Map<string, ReturnType<typeof composeSeasonNameParts>>();
  if (playerIds.length > 0) {
    const playersRes = await locals.supabase
      .from('players')
      .select('id, display_name, real_first_name, real_last_name')
      .in('id', playerIds);

    if (!playersRes.error) {
      playerLabelById = new Map(
        (playersRes.data ?? []).map((p) => [p.id, composeSeasonNameParts(p)])
      );
    }
  }

  const withNameParts = (row: any) => {
    const parts = playerLabelById.get(row.player_id);
    const fallbackName = String(row.display_name ?? '').trim();
    return {
      ...row,
      player_name_primary: parts?.primary ?? (fallbackName || 'Unnamed player'),
      player_name_secondary: parts?.secondary ?? null
    };
  };

  return {
    match: matchRes.data,
    results: results.map(withNameParts),
    ratingDeltas: ratingDeltas.map(withNameParts)
  };
};
