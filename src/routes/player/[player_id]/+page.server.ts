import { error as kitError } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
  const player_id = params.player_id;
  const seasonParam = url.searchParams.get('season');

  const playerRes = await locals.supabase
    .from('players')
    .select('id, display_name, is_active')
    .eq('id', player_id)
    .maybeSingle();

  if (playerRes.error || !playerRes.data) throw kitError(404, 'Player not found');

  let seasonId = seasonParam || null;
  if (!seasonId) {
    const { data: active } = await locals.supabase
      .from('seasons')
      .select('id')
      .eq('is_active', true)
      .order('start_date', { ascending: false })
      .limit(1);
    seasonId = active?.[0]?.id ?? null;
  }

  const seasonsRes = await locals.supabase
    .from('seasons')
    .select('id, name, start_date')
    .order('start_date', { ascending: false });

  let stats = null;
  let standingsRow = null;
  let matchHistory: any[] = [];
  let pointHistory: any[] = [];
  let ratingHistory: any[] = [];

  if (seasonId) {
    const statsRes = await locals.supabase
      .from('v_season_player_stats')
      .select('*')
      .eq('season_id', seasonId)
      .eq('player_id', player_id)
      .maybeSingle();
    stats = statsRes.error ? null : statsRes.data;

    const standingsRes = await locals.supabase
      .from('v_season_standings')
      .select('*')
      .eq('season_id', seasonId)
      .eq('player_id', player_id)
      .maybeSingle();
    standingsRow = standingsRes.error ? null : standingsRes.data;

    const mhRes = await locals.supabase
      .from('v_player_match_history')
      .select('*')
      .eq('season_id', seasonId)
      .eq('player_id', player_id)
      .order('played_at', { ascending: false })
      .limit(100);
    matchHistory = mhRes.error ? [] : (mhRes.data ?? []);

    const phRes = await locals.supabase
      .from('v_player_point_history')
      .select('*')
      .eq('season_id', seasonId)
      .eq('player_id', player_id)
      .order('played_at', { ascending: true })
      .limit(200);
    pointHistory = phRes.error ? [] : (phRes.data ?? []);

    const rhRes = await locals.supabase
      .from('v_rating_history')
      .select('*')
      .eq('is_lifetime', false)
      .eq('season_id', seasonId)
      .eq('player_id', player_id)
      .order('played_at', { ascending: true })
      .limit(200);
    ratingHistory = rhRes.error ? [] : (rhRes.data ?? []);
  }

  return {
    player: playerRes.data,
    seasons: seasonsRes.error ? [] : (seasonsRes.data ?? []),
    seasonId,
    stats,
    standingsRow,
    matchHistory,
    pointHistory,
    ratingHistory
  };
};
