import { error as kitError } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { composeSeasonNameParts } from '$lib/player-name';

export const load: PageServerLoad = async ({ locals, params }) => {
  const season_id = params.season_id;
  const FALLBACK_RATING_START_DATE = '2026-01-01';

  const seasonRes = await locals.supabase
    .from('seasons')
    .select('id, name, start_date, end_date, is_active')
    .eq('id', season_id)
    .maybeSingle();

  if (seasonRes.error || !seasonRes.data) throw kitError(404, 'Season not found');

  const ratingStartSeasonRes = await locals.supabase
    .from('seasons')
    .select('start_date')
    .ilike('name', 'spring 2026%')
    .order('start_date', { ascending: true })
    .limit(1)
    .maybeSingle();
  const ratingStartDate = String(ratingStartSeasonRes.data?.start_date ?? '').trim() || FALLBACK_RATING_START_DATE;
  const isRatingSeason = String(seasonRes.data.start_date ?? '').trim() >= ratingStartDate;

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
    .limit(10);

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

  let ratingByPlayerId = new Map<string, number>();
  if (isRatingSeason && playerIds.length > 0) {
    const ratingsRes = await locals.supabase
      .from('v_rating_history')
      .select('player_id, new_rate, played_at, match_id')
      .eq('is_lifetime', true)
      .in('player_id', playerIds)
      .gte('played_at', ratingStartDate)
      .order('played_at', { ascending: false })
      .order('match_id', { ascending: false });

    if (!ratingsRes.error) {
      for (const row of ratingsRes.data ?? []) {
        const id = String(row?.player_id ?? '').trim();
        const rate = Number(row?.new_rate);
        if (!id || !Number.isFinite(rate) || ratingByPlayerId.has(id)) continue;
        ratingByPlayerId.set(id, rate);
      }
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

  const recentMatchesBase = matchesRes.error ? [] : (matchesRes.data ?? []);
  const recentMatchIds = recentMatchesBase.map((m: any) => String(m?.id ?? '')).filter((id) => id.length > 0);
  const summaryByMatchId = new Map<
    string,
    { winner_name: string | null; top_raw_points: number | null; sp_spread: number | null }
  >();

  if (recentMatchIds.length > 0) {
    const finalRowsRes = await locals.supabase
      .from('v_final_results')
      .select('match_id, player_id, seat, display_name, placement, raw_points, club_points')
      .in('match_id', recentMatchIds);

    let finalRows: any[] = [];
    if (!finalRowsRes.error) {
      finalRows = finalRowsRes.data ?? [];
    } else {
      // Fallback in case view permissions or schema drift blocks v_final_results.
      const mrRes = await locals.supabase
        .from('match_results')
        .select('match_id, player_id, seat, placement, raw_points, club_points')
        .in('match_id', recentMatchIds);
      finalRows = mrRes.error ? [] : (mrRes.data ?? []);
    }

    if (finalRows.length > 0) {
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
            winner_name: null,
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
          winner_name: winnerName,
          top_raw_points: rawVals.length > 0 ? Math.max(...rawVals) : null,
          sp_spread: spVals.length > 0 ? Math.max(...spVals) - Math.min(...spVals) : null
        });
      }
    }
  }

  const recentMatches = recentMatchesBase.map((m: any) => {
    const match_id = String(m?.id ?? '');
    const summary = summaryByMatchId.get(match_id);
    return {
      ...m,
      winner_name: summary?.winner_name ?? null,
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
