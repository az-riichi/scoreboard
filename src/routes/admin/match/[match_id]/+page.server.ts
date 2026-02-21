import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireAdmin } from '$lib/server/admin';
import { composePlayerDisplayName } from '$lib/player-name';

const CHOMBO_PREFIX = 'CHOMBO';

export const load: PageServerLoad = async ({ locals, params }) => {
  await requireAdmin(locals);
  const match_id = params.match_id;
  const FALLBACK_RATING_START_DATE = '2026-01-01';

  const matchRes = await locals.supabase
    .from('matches')
    .select('id, season_id, ruleset_id, played_at, table_label, notes, status, game_number, table_mode, extra_sticks')
    .eq('id', match_id)
    .maybeSingle();

  if (matchRes.error || !matchRes.data) throw redirect(303, '/admin');

  const playersRes = await locals.supabase
    .from('players')
    .select('id, display_name, real_first_name, real_last_name, show_display_name, show_real_first_name, show_real_last_name, is_active')
    .order('created_at', { ascending: true });

  const resultsRes = await locals.supabase
    .from('match_results')
    .select('seat, player_id, raw_points, placement, club_points')
    .eq('match_id', match_id);

  const rulesetRes = await locals.supabase
    .from('rulesets')
    .select('id, name, return_points, point_divisor, uma_1, uma_2, uma_3, uma_4, oka_1, oka_2, oka_3, oka_4')
    .eq('id', matchRes.data.ruleset_id)
    .maybeSingle();

  const ratingStartSeasonRes = await locals.supabase
    .from('seasons')
    .select('start_date')
    .ilike('name', 'spring 2026%')
    .order('start_date', { ascending: true })
    .limit(1)
    .maybeSingle();
  const ratingStartDate = String(ratingStartSeasonRes.data?.start_date ?? '').trim() || FALLBACK_RATING_START_DATE;

  const lifetimeRatingsRes = await locals.supabase
    .from('v_rating_history')
    .select('player_id, new_rate, played_at, match_id')
    .eq('is_lifetime', true)
    .gte('played_at', ratingStartDate)
    .order('played_at', { ascending: false })
    .order('match_id', { ascending: false });

  const penaltyReasonPrefix = `${CHOMBO_PREFIX}:${match_id}:%`;
  const penaltiesRes = await locals.supabase
    .from('adjustments')
    .select('id, player_id, points, reason, created_at')
    .eq('season_id', matchRes.data.season_id)
    .like('reason', penaltyReasonPrefix)
    .order('created_at', { ascending: false });

  const players =
    playersRes.error
      ? []
      : (playersRes.data ?? [])
          .map((p) => ({ ...p, label: composePlayerDisplayName(p) }))
          .sort((a, b) => a.label.localeCompare(b.label));

  const playerLabelById = new Map(players.map((p) => [p.id, p.label]));
  const penalties = penaltiesRes.error
    ? []
    : (penaltiesRes.data ?? []).map((p) => {
        const prefix = `${CHOMBO_PREFIX}:${match_id}:`;
        const reason_code = p.reason.startsWith(prefix) ? p.reason.slice(prefix.length) : p.reason;
        return {
          ...p,
          reason_code,
          player_label: playerLabelById.get(p.player_id) ?? p.player_id.slice(0, 8)
        };
      });

  const lifetimeRatings: Array<{ player_id: string; rate: number; games_played: number }> = [];
  if (!lifetimeRatingsRes.error) {
    const latestRateByPlayer = new Map<string, number>();
    const gamesByPlayer = new Map<string, number>();
    for (const row of lifetimeRatingsRes.data ?? []) {
      const player_id = String(row?.player_id ?? '').trim();
      const rate = Number(row?.new_rate);
      if (!player_id) continue;
      gamesByPlayer.set(player_id, (gamesByPlayer.get(player_id) ?? 0) + 1);
      if (!Number.isFinite(rate) || latestRateByPlayer.has(player_id)) continue;
      latestRateByPlayer.set(player_id, rate);
    }
    for (const [player_id, rate] of latestRateByPlayer.entries()) {
      lifetimeRatings.push({ player_id, rate, games_played: gamesByPlayer.get(player_id) ?? 0 });
    }
  }

  return {
    match: matchRes.data,
    players,
    results: resultsRes.error ? [] : (resultsRes.data ?? []),
    ruleset: rulesetRes.error ? null : rulesetRes.data,
    lifetimeRatings,
    penalties
  };
};

function getStr(f: FormData, k: string) {
  return String(f.get(k) ?? '').trim();
}
function getInt(f: FormData, k: string) {
  const n = Number(f.get(k));
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}
function parseDayBounds(playedAt: string) {
  const m = playedAt.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (!m) return null;
  const day = m[1];
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const next = new Date(d);
  next.setUTCDate(next.getUTCDate() + 1);
  const nextDay = next.toISOString().slice(0, 10);
  return {
    dayStart: `${day}T00:00:00`,
    dayEnd: `${nextDay}T00:00:00`
  };
}

export const actions: Actions = {
  deleteGame: async ({ locals, params }) => {
    await requireAdmin(locals);
    const match_id = params.match_id;

    const matchRes = await locals.supabase
      .from('matches')
      .select('id, season_id, status')
      .eq('id', match_id)
      .maybeSingle();
    if (matchRes.error || !matchRes.data) return fail(400, { message: 'Match not found.' });

    const reasonLike = `${CHOMBO_PREFIX}:${match_id}:%`;
    const delPenRes = await locals.supabase
      .from('adjustments')
      .delete()
      .eq('season_id', matchRes.data.season_id)
      .like('reason', reasonLike);
    if (delPenRes.error) return fail(400, { message: delPenRes.error.message });

    const delMatchRes = await locals.supabase
      .from('matches')
      .delete()
      .eq('id', match_id);
    if (delMatchRes.error) return fail(400, { message: delMatchRes.error.message });

    if (matchRes.data.status === 'final') {
      const seasonRecompute = await locals.supabase.rpc('recompute_season_ratings', {
        p_season_id: matchRes.data.season_id
      });
      if (seasonRecompute.error) return fail(400, { message: seasonRecompute.error.message });

      const lifetimeRecompute = await locals.supabase.rpc('recompute_lifetime_ratings');
      if (lifetimeRecompute.error) return fail(400, { message: lifetimeRecompute.error.message });
    }

    throw redirect(303, '/admin/matches');
  },

  saveMatchMeta: async ({ request, locals, params }) => {
    await requireAdmin(locals);
    const match_id = params.match_id;

    const f = await request.formData();
    const played_at = getStr(f, 'played_at');
    const table_mode_raw = getStr(f, 'table_mode').toUpperCase();
    const ex_raw = getStr(f, 'extra_sticks');
    const notes = getStr(f, 'notes');

    if (!played_at) return fail(400, { message: 'Played at is required.' });
    const dayBounds = parseDayBounds(played_at);
    if (!dayBounds) {
      return fail(400, { message: 'Played at must be a valid date/time.' });
    }

    const table_mode = table_mode_raw;
    if (table_mode !== 'A' && table_mode !== 'M') {
      return fail(400, { message: 'Tbl must be A or M.' });
    }

    const dayCountRes = await locals.supabase
      .from('matches')
      .select('id', { count: 'exact', head: true })
      .gte('played_at', dayBounds.dayStart)
      .lt('played_at', dayBounds.dayEnd)
      .neq('id', match_id);
    if (dayCountRes.error) return fail(400, { message: dayCountRes.error.message });
    const game_number = (dayCountRes.count ?? 0) + 1;
    const table_label = `${table_mode}-${game_number}`;

    const extra_sticks = ex_raw === '' ? 0 : Number(ex_raw);
    if (!Number.isInteger(extra_sticks) || extra_sticks < 0) {
      return fail(400, { message: 'Ex must be an integer >= 0.' });
    }

    const { error } = await locals.supabase
      .from('matches')
      .update({
        played_at,
        table_label,
        game_number,
        table_mode,
        extra_sticks,
        notes: notes || null
      })
      .eq('id', match_id);

    if (error) return fail(400, { message: error.message });
    return { message: 'Match details updated.' };
  },

  saveResults: async ({ request, locals, params }) => {
    await requireAdmin(locals);
    const match_id = params.match_id;

    const f = await request.formData();
    const seats = ['E','S','W','N'] as const;

    const rows = seats.map((seat) => ({
      match_id,
      seat,
      player_id: getStr(f, `p_${seat}`),
      raw_points: getInt(f, `raw_${seat}`)
    }));

    const players = rows.map((r) => r.player_id).filter(Boolean);
    if (players.length !== 4) return fail(400, { message: 'Pick 4 players.' });
    if (new Set(players).size !== 4) return fail(400, { message: 'Players must be distinct.' });

    const { error } = await locals.supabase
      .from('match_results')
      .upsert(rows, { onConflict: 'match_id,seat' });

    if (error) return fail(400, { message: error.message });
    return { message: 'Saved.' };
  },

  addPenalty: async ({ request, locals, params }) => {
    await requireAdmin(locals);
    const match_id = params.match_id;
    const f = await request.formData();

    const player_id = getStr(f, 'player_id');
    const points = Number(getStr(f, 'points'));
    const reason_code = getStr(f, 'reason_code').toUpperCase();

    if (!player_id) return fail(400, { message: 'Choose a player for penalty.' });
    if (!reason_code) return fail(400, { message: 'Reason code is required.' });
    if (!/^[A-Z0-9_-]{1,40}$/.test(reason_code)) {
      return fail(400, { message: 'Reason code can use A-Z, 0-9, _ and - only (max 40 chars).' });
    }
    if (!Number.isFinite(points) || !Number.isInteger(points) || points === 0) {
      return fail(400, { message: 'Penalty points must be a non-zero integer.' });
    }

    const matchRes = await locals.supabase
      .from('matches')
      .select('season_id')
      .eq('id', match_id)
      .maybeSingle();
    if (matchRes.error || !matchRes.data) return fail(400, { message: 'Match not found.' });

    const participantRes = await locals.supabase
      .from('match_results')
      .select('player_id')
      .eq('match_id', match_id)
      .eq('player_id', player_id)
      .maybeSingle();
    if (participantRes.error) return fail(400, { message: participantRes.error.message });
    if (!participantRes.data) {
      return fail(400, { message: 'Penalty player must be one of the entered players in this match.' });
    }

    const reason = `${CHOMBO_PREFIX}:${match_id}:${reason_code}`;

    const duplicateRes = await locals.supabase
      .from('adjustments')
      .select('id')
      .eq('season_id', matchRes.data.season_id)
      .eq('player_id', player_id)
      .eq('reason', reason)
      .maybeSingle();
    if (duplicateRes.error) return fail(400, { message: duplicateRes.error.message });
    if (duplicateRes.data) {
      return fail(400, { message: 'This penalty code already exists for that player in this match.' });
    }

    const insertRes = await locals.supabase.from('adjustments').insert({
      season_id: matchRes.data.season_id,
      player_id,
      points,
      reason,
      created_by: locals.userId
    });
    if (insertRes.error) return fail(400, { message: insertRes.error.message });

    return { message: 'Penalty saved.' };
  },

  removePenalty: async ({ request, locals, params }) => {
    await requireAdmin(locals);
    const match_id = params.match_id;
    const f = await request.formData();
    const adjustment_id = getStr(f, 'adjustment_id');
    if (!adjustment_id) return fail(400, { message: 'Missing penalty id.' });

    const matchRes = await locals.supabase
      .from('matches')
      .select('season_id')
      .eq('id', match_id)
      .maybeSingle();
    if (matchRes.error || !matchRes.data) return fail(400, { message: 'Match not found.' });

    const reasonLike = `${CHOMBO_PREFIX}:${match_id}:%`;
    const delRes = await locals.supabase
      .from('adjustments')
      .delete()
      .eq('id', adjustment_id)
      .eq('season_id', matchRes.data.season_id)
      .like('reason', reasonLike);

    if (delRes.error) return fail(400, { message: delRes.error.message });
    return { message: 'Penalty removed.' };
  },

  recompute: async ({ locals, params }) => {
    await requireAdmin(locals);
    const match_id = params.match_id;

    const { error } = await locals.supabase.rpc('recompute_match_derived', { p_match_id: match_id });
    if (error) return fail(400, { message: error.message });
    return { message: 'Recomputed placement and Season Points (SP).' };
  },

  finalize: async ({ locals, params }) => {
    await requireAdmin(locals);
    const match_id = params.match_id;

    const { error } = await locals.supabase.rpc('finalize_match', { p_match_id: match_id, p_update_lifetime: true });
    if (error) return fail(400, { message: error.message });

    throw redirect(303, `/admin/match/${match_id}`);
  }
};
