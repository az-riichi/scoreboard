import { error as kitError } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { composeSeasonNameParts } from '$lib/player-name';

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

  const standings = standingsRes.error ? [] : (standingsRes.data ?? []);
  const playerIds = Array.from(
    new Set(
      standings
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

  const standingsWithNames = standings.map((row: any) => {
    const parts = playerLabelById.get(row.player_id);
    const fallbackName = String(row.display_name ?? '').trim();
    return {
      ...row,
      player_name_primary: parts?.primary ?? (fallbackName || 'Unnamed player'),
      player_name_secondary: parts?.secondary ?? null
    };
  });

  return {
    season: seasonRes.data,
    standings: standingsWithNames,
    recentMatches: matchesRes.error ? [] : (matchesRes.data ?? [])
  };
};
