import { error as kitError, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { composeSeasonNameParts } from '$lib/player-name';
import { getActiveSeasonId, getLifetimeRatingSnapshot, getRatingStartDate } from '$lib/server/public-cache';

function asText(value: unknown) {
  return String(value ?? '').trim();
}

function asBool(value: unknown) {
  return String(value ?? '') === 'on';
}

export const load: PageServerLoad = async ({ locals, params, url }) => {
  const player_id = params.player_id;
  const seasonParam = url.searchParams.get('season');
  const [playerRes, ownRes, seasonsRes, ratingStartDate, activeSeasonId] = await Promise.all([
    locals.supabase
      .from('players')
      .select(
        'id, display_name, real_first_name, real_last_name, show_display_name, show_real_first_name, show_real_last_name, is_active'
      )
      .eq('id', player_id)
      .maybeSingle(),
    locals.userId
      ? locals.supabase
          .from('player_accounts')
          .select('auth_user_id')
          .eq('auth_user_id', locals.userId)
          .eq('player_id', player_id)
          .maybeSingle()
      : Promise.resolve(null),
    locals.supabase.from('seasons').select('id, name, start_date').order('start_date', { ascending: false }),
    getRatingStartDate(locals.supabase),
    seasonParam ? Promise.resolve(null) : getActiveSeasonId(locals.supabase)
  ]);

  if (playerRes.error || !playerRes.data) throw kitError(404, 'Player not found');

  const canEditDisplay = !!(ownRes && !ownRes.error && ownRes.data);

  const nameParts = composeSeasonNameParts(playerRes.data);
  const player = {
    ...playerRes.data,
    player_name_primary: nameParts.primary,
    player_name_secondary: nameParts.secondary
  };

  const seasonId = seasonParam || activeSeasonId || null;
  const selectedSeason = (seasonsRes.data ?? []).find((s) => s.id === seasonId) ?? null;
  const isRatingSeason = selectedSeason ? String(selectedSeason.start_date ?? '').trim() >= ratingStartDate : false;

  const lifetimeRatings = await getLifetimeRatingSnapshot(locals.supabase, ratingStartDate);

  let currentRating = { rate: 1500, games_played: 0, updated_at: null as string | null };
  const myRate = lifetimeRatings.latestRateByPlayer.get(player_id);
  if (Number.isFinite(myRate)) currentRating.rate = Number(myRate);
  currentRating.games_played = lifetimeRatings.gamesByPlayer.get(player_id) ?? 0;
  currentRating.updated_at = lifetimeRatings.updatedAtByPlayer.get(player_id) ?? null;

  const currentRatingRank = lifetimeRatings.rankByPlayer.get(player_id) ?? null;
  const currentRatingRankTotal = lifetimeRatings.totalPlayers;

  let stats = null;
  let standingsRow = null;
  let seasonEligibleRank: number | null = null;
  let matchHistory: any[] = [];
  let pointHistory: any[] = [];
  let ratingHistory: any[] = [];
  let bestRawMatch: any = null;
  let worstRawMatch: any = null;

  if (seasonId) {
    const [statsRes, standingsRes, seasonStandingsRes, mhRes, phRes, bestRawRes, worstRawRes] = await Promise.all([
      locals.supabase
        .from('v_season_player_stats')
        .select('*')
        .eq('season_id', seasonId)
        .eq('player_id', player_id)
        .maybeSingle(),
      locals.supabase
        .from('v_season_standings')
        .select('*')
        .eq('season_id', seasonId)
        .eq('player_id', player_id)
        .maybeSingle(),
      locals.supabase
        .from('v_season_standings')
        .select('player_id, rank, games_played')
        .eq('season_id', seasonId)
        .order('rank', { ascending: true })
        .order('player_id', { ascending: true }),
      locals.supabase
        .from('v_player_match_history')
        .select('*')
        .eq('season_id', seasonId)
        .eq('player_id', player_id)
        .order('played_at', { ascending: false })
        .limit(100),
      locals.supabase
        .from('v_player_point_history')
        .select('*')
        .eq('season_id', seasonId)
        .eq('player_id', player_id)
        .order('played_at', { ascending: true })
        .limit(200),
      locals.supabase
        .from('v_player_match_history')
        .select('match_id, played_at, raw_points')
        .eq('season_id', seasonId)
        .eq('player_id', player_id)
        .order('raw_points', { ascending: false })
        .order('played_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      locals.supabase
        .from('v_player_match_history')
        .select('match_id, played_at, raw_points')
        .eq('season_id', seasonId)
        .eq('player_id', player_id)
        .order('raw_points', { ascending: true })
        .order('played_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    ]);

    stats = statsRes.error ? null : statsRes.data;
    standingsRow = standingsRes.error ? null : standingsRes.data;
    if (!seasonStandingsRes.error) {
      const denseRankRemap = new Map<number, number>();
      let nextEligibleRank = 1;
      for (const row of seasonStandingsRes.data ?? []) {
        const rowPlayerId = String(row?.player_id ?? '').trim();
        const rowRank = Number(row?.rank);
        const gamesPlayed = Number(row?.games_played);
        if (!rowPlayerId || !Number.isFinite(rowRank) || !Number.isFinite(gamesPlayed) || gamesPlayed <= 4) {
          continue;
        }
        if (!denseRankRemap.has(rowRank)) {
          denseRankRemap.set(rowRank, nextEligibleRank);
          nextEligibleRank += 1;
        }
        if (rowPlayerId === player_id) {
          seasonEligibleRank = denseRankRemap.get(rowRank) ?? null;
          break;
        }
      }
    }

    matchHistory = mhRes.error ? [] : (mhRes.data ?? []);
    pointHistory = phRes.error ? [] : (phRes.data ?? []);

    const seasonMatchIdsForRating = Array.from(
      new Set(
        [...pointHistory, ...matchHistory]
          .map((row) => String(row?.match_id ?? '').trim())
          .filter((id) => id.length > 0)
      )
    );
    if (isRatingSeason && seasonMatchIdsForRating.length > 0) {
      const rhRes = await locals.supabase
        .from('v_rating_history')
        .select('*')
        .eq('is_lifetime', true)
        .eq('player_id', player_id)
        .in('match_id', seasonMatchIdsForRating)
        .order('played_at', { ascending: true });
      ratingHistory = rhRes.error ? [] : (rhRes.data ?? []);
    } else {
      ratingHistory = [];
    }

    bestRawMatch = bestRawRes.error ? null : bestRawRes.data;
    worstRawMatch = worstRawRes.error ? null : worstRawRes.data;

    const recentMatchIds = Array.from(
      new Set(
        matchHistory
          .map((m) => String(m?.match_id ?? '').trim())
          .filter((id) => id.length > 0)
      )
    );

    const ratingDeltaByMatch = new Map<string, number>();
    if (isRatingSeason && recentMatchIds.length > 0) {
      for (const row of ratingHistory) {
        const id = String(row?.match_id ?? '').trim();
        const delta = Number(row?.delta);
        if (id && Number.isFinite(delta) && !ratingDeltaByMatch.has(id)) {
          ratingDeltaByMatch.set(id, delta);
        }
      }
    }

    const historyMatchIds = Array.from(
      new Set(
        [...pointHistory, ...ratingHistory]
          .map((m) => String(m?.match_id ?? '').trim())
          .filter((id) => id.length > 0)
      )
    );
    const labelMatchIds = Array.from(new Set([...recentMatchIds, ...historyMatchIds]));

    const matchLabelById = new Map<string, string>();
    if (labelMatchIds.length > 0) {
      const labelsRes = await locals.supabase
        .from('matches')
        .select('id, table_label, table_mode, game_number')
        .in('id', labelMatchIds);
      if (!labelsRes.error) {
        for (const m of labelsRes.data ?? []) {
          const fallbackTable = m.table_mode && m.game_number ? `${m.table_mode}-${m.game_number}` : null;
          const label = String(m.table_label ?? fallbackTable ?? m.id).trim();
          if (m.id) matchLabelById.set(m.id, label);
        }
      }
    }

    matchHistory = matchHistory.map((m) => {
      const match_id = String(m?.match_id ?? '');
      return {
        ...m,
        match_label: matchLabelById.get(match_id) ?? match_id.slice(0, 8),
        rating_delta: ratingDeltaByMatch.get(match_id) ?? null
      };
    });

    pointHistory = pointHistory.map((row) => {
      const match_id = String(row?.match_id ?? '');
      return {
        ...row,
        match_label: matchLabelById.get(match_id) ?? match_id.slice(0, 8)
      };
    });

    ratingHistory = ratingHistory.map((row) => {
      const match_id = String(row?.match_id ?? '');
      return {
        ...row,
        match_label: matchLabelById.get(match_id) ?? match_id.slice(0, 8)
      };
    });
  }

  return {
    player,
    canEditDisplay,
    seasons: seasonsRes.error ? [] : (seasonsRes.data ?? []),
    seasonId,
    currentRating,
    currentRatingRank,
    currentRatingRankTotal,
    stats,
    standingsRow,
    seasonEligibleRank,
    matchHistory,
    pointHistory,
    ratingHistory,
    bestRawMatch,
    worstRawMatch
  };
};

export const actions: Actions = {
  updateDisplay: async ({ request, locals, params }) => {
    if (!locals.userId || !locals.user) return fail(401, { message: 'Sign in to update your display settings.' });

    const f = await request.formData();
    const display_name = asText(f.get('display_name')) || null;
    const real_first_name = asText(f.get('real_first_name')) || null;
    const real_last_name = asText(f.get('real_last_name')) || null;
    const show_display_name = asBool(f.get('show_display_name'));
    const show_real_first_name = asBool(f.get('show_real_first_name'));
    const show_real_last_name = asBool(f.get('show_real_last_name'));

    if (!display_name && !real_first_name) {
      return fail(400, { message: 'Provide at least Display name or Real first name.' });
    }
    if (!show_display_name && !show_real_first_name) {
      return fail(400, { message: 'Enable at least Display name or Real first name.' });
    }
    if (show_display_name && !display_name) {
      return fail(400, { message: 'Display name is enabled but empty.' });
    }
    if (show_real_first_name && !real_first_name) {
      return fail(400, { message: 'Real first name is enabled but empty.' });
    }
    if (show_real_last_name && !real_last_name) {
      return fail(400, { message: 'Real last name is enabled but empty.' });
    }

    const updateRes = await locals.supabase.rpc('update_my_player_display', {
      p_display_name: display_name,
      p_real_first_name: real_first_name,
      p_real_last_name: real_last_name,
      p_show_display_name: show_display_name,
      p_show_real_first_name: show_real_first_name,
      p_show_real_last_name: show_real_last_name
    });

    if (updateRes.error) return fail(400, { message: updateRes.error.message });

    if (updateRes.data && String(updateRes.data) !== params.player_id) {
      return fail(403, { message: 'You can only update your own linked player profile.' });
    }

    return { message: 'Display settings updated.' };
  }
};
