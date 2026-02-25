import { error as kitError } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { composeSeasonNameParts } from '$lib/player-name';
import { getRatingStartDate } from '$lib/server/public-cache';

export const load: PageServerLoad = async ({ locals, params }) => {
  const season_id = params.season_id;

  const [seasonRes, ratingStartDate, standingsRes, matchesRes] = await Promise.all([
    locals.supabase
      .from('seasons')
      .select('id, name, start_date, end_date, is_active')
      .eq('id', season_id)
      .maybeSingle(),
    getRatingStartDate(locals.supabase),
    locals.supabase.from('v_season_standings').select('*').eq('season_id', season_id).order('rank', { ascending: true }),
    locals.supabase
      .from('matches')
      .select('id, played_at, table_label')
      .eq('season_id', season_id)
      .eq('status', 'final')
      .order('played_at', { ascending: false })
      .limit(10)
  ]);

  if (seasonRes.error || !seasonRes.data) throw kitError(404, 'Season not found');

  const isRatingSeason = String(seasonRes.data.start_date ?? '').trim() >= ratingStartDate;

  const standings = standingsRes.error ? [] : (standingsRes.data ?? []);
  const playerIds = Array.from(
    new Set(
      standings
        .map((row: any) => row.player_id)
        .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
    )
  );

  const recentMatchesBase = matchesRes.error ? [] : (matchesRes.data ?? []);
  const recentMatchIds = recentMatchesBase.map((m: any) => String(m?.id ?? '')).filter((id) => id.length > 0);

  const [playersRes, ratingsRes, finalRows] = await Promise.all([
    playerIds.length > 0
      ? locals.supabase.from('players').select('id, display_name, real_first_name, real_last_name').in('id', playerIds)
      : Promise.resolve(null),
    isRatingSeason && playerIds.length > 0
      ? locals.supabase
          .from('v_rating_history')
          .select('player_id, new_rate, played_at, match_id')
          .eq('is_lifetime', true)
          .in('player_id', playerIds)
          .gte('played_at', ratingStartDate)
          .order('played_at', { ascending: false })
          .order('match_id', { ascending: false })
      : Promise.resolve(null),
    recentMatchIds.length > 0
      ? (async () => {
          const finalRowsRes = await locals.supabase
            .from('v_final_results')
            .select('match_id, player_id, seat, display_name, placement, raw_points, club_points')
            .in('match_id', recentMatchIds);

          if (!finalRowsRes.error) return finalRowsRes.data ?? [];

          const mrRes = await locals.supabase
            .from('match_results')
            .select('match_id, player_id, seat, placement, raw_points, club_points')
            .in('match_id', recentMatchIds);
          return mrRes.error ? [] : (mrRes.data ?? []);
        })()
      : Promise.resolve([])
  ]);

  let playerLabelById = new Map<string, ReturnType<typeof composeSeasonNameParts>>();
  if (playersRes && !playersRes.error) {
    playerLabelById = new Map((playersRes.data ?? []).map((p) => [p.id, composeSeasonNameParts(p)]));
  }

  const ratingByPlayerId = new Map<string, number>();
  if (ratingsRes && !ratingsRes.error) {
    for (const row of ratingsRes.data ?? []) {
      const id = String(row?.player_id ?? '').trim();
      const rate = Number(row?.new_rate);
      if (!id || !Number.isFinite(rate) || ratingByPlayerId.has(id)) continue;
      ratingByPlayerId.set(id, rate);
    }
  }

  const standingsWithNames = standings.map((row: any) => {
    const parts = playerLabelById.get(row.player_id);
    const fallbackName = String(row.display_name ?? '').trim();
    return {
      ...row,
      player_name_primary: parts?.primary ?? (fallbackName || 'Unnamed player'),
      player_name_secondary: parts?.secondary ?? null,
      rating: isRatingSeason ? (ratingByPlayerId.get(String(row.player_id ?? '')) ?? null) : null
    };
  });

  const summaryByMatchId = new Map<
    string,
    {
      winner_name_primary: string | null;
      winner_name_secondary: string | null;
      winner_name: string | null;
      winner_player_id: string | null;
      top_raw_points: number | null;
      sp_spread: number | null;
    }
  >();

  if (recentMatchIds.length > 0 && finalRows.length > 0) {
    const rowsByMatch = new Map<string, any[]>();
    for (const row of finalRows) {
      const mid = String(row?.match_id ?? '');
      if (!mid) continue;
      if (!rowsByMatch.has(mid)) rowsByMatch.set(mid, []);
      rowsByMatch.get(mid)!.push(row);
    }

    for (const match_id of recentMatchIds) {
      const rows = rowsByMatch.get(match_id) ?? [];
      if (rows.length === 0) {
        summaryByMatchId.set(match_id, {
          winner_name_primary: null,
          winner_name_secondary: null,
          winner_name: null,
          winner_player_id: null,
          top_raw_points: null,
          sp_spread: null
        });
        continue;
      }

      const ordered = [...rows].sort((a, b) => {
        const ap = Number(a?.placement);
        const bp = Number(b?.placement);
        if (Number.isFinite(ap) && Number.isFinite(bp) && ap !== bp) return ap - bp;
        const ar = Number(a?.raw_points);
        const br = Number(b?.raw_points);
        if (Number.isFinite(ar) && Number.isFinite(br) && ar !== br) return br - ar;
        return 0;
      });
      const winner = ordered.find((r) => Number(r?.placement) === 1) ?? ordered[0];
      const rawVals = rows.map((r) => Number(r?.raw_points)).filter((v) => Number.isFinite(v));
      const spVals = rows.map((r) => Number(r?.club_points)).filter((v) => Number.isFinite(v));
      const winnerPlayerId = String(winner?.player_id ?? '');
      const winnerParts = playerLabelById.get(winnerPlayerId);
      const winnerPrimary = winnerParts?.primary ?? String(winner?.display_name ?? '').trim();
      const winnerSecondary = winnerParts?.secondary ?? null;
      const winnerName = winnerPrimary
        ? winnerSecondary
          ? `${winnerPrimary} (${winnerSecondary})`
          : winnerPrimary
        : winnerPlayerId
          ? winnerPlayerId.slice(0, 8)
          : `Seat ${winner?.seat ?? '-'}`;

      summaryByMatchId.set(match_id, {
        winner_name_primary: winnerPrimary || (winnerName || null),
        winner_name_secondary: winnerPrimary ? winnerSecondary : null,
        winner_name: winnerName,
        winner_player_id: winnerPlayerId || null,
        top_raw_points: rawVals.length > 0 ? Math.max(...rawVals) : null,
        sp_spread: spVals.length > 0 ? Math.max(...spVals) - Math.min(...spVals) : null
      });
    }
  } else if (recentMatchIds.length > 0) {
    for (const match_id of recentMatchIds) {
      summaryByMatchId.set(match_id, {
        winner_name_primary: null,
        winner_name_secondary: null,
        winner_name: null,
        winner_player_id: null,
        top_raw_points: null,
        sp_spread: null
      });
    }
  }

  const recentMatches = recentMatchesBase.map((m: any) => {
    const match_id = String(m?.id ?? '');
    const summary = summaryByMatchId.get(match_id);
    return {
      ...m,
      winner_name_primary: summary?.winner_name_primary ?? null,
      winner_name_secondary: summary?.winner_name_secondary ?? null,
      winner_name: summary?.winner_name ?? null,
      winner_player_id: summary?.winner_player_id ?? null,
      top_raw_points: summary?.top_raw_points ?? null,
      sp_spread: summary?.sp_spread ?? null
    };
  });

  return {
    season: seasonRes.data,
    isRatingSeason,
    standings: standingsWithNames,
    recentMatches
  };
};
