import { error as kitError, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireAdmin } from '$lib/server/admin';
import { composeSeasonNameParts } from '$lib/player-name';
import {
  parseArizonaDayBoundsFromDatetimeLocal,
  parseArizonaLocalDatetimeToUtcIso,
  toArizonaDatetimeLocalValue
} from '$lib/arizona-time';
import { resolveCasualEvent } from '$lib/server/casual-events';

const CHOMBO_PREFIX = 'CHOMBO';
const RESTRICTION_PAGE_SIZE = 500;

async function loadEffectiveRestrictions(locals: App.Locals, matchDay: string) {
  const restrictions: Array<{
    id: string;
    player_id: string;
    action_type: 'suspension' | 'ban';
    expires_on: string | null;
  }> = [];

  let offset = 0;
  for (;;) {
    const response = await locals.supabase
      .from('discipline_actions')
      .select('id, player_id, action_type, expires_on', { count: 'exact' })
      .in('action_type', ['suspension', 'ban'])
      .is('revoked_at', null)
      .lte('effective_on', matchDay)
      .or(`expires_on.is.null,expires_on.gte.${matchDay}`)
      .order('id', { ascending: true })
      .range(offset, offset + RESTRICTION_PAGE_SIZE - 1);

    if (response.error) return { data: [], error: response.error };

    const page = (response.data ?? []) as typeof restrictions;
    restrictions.push(...page);
    offset += page.length;
    if (page.length === 0 || (response.count != null && offset >= response.count)) break;
    if (response.count == null && page.length < RESTRICTION_PAGE_SIZE) break;
  }

  return { data: restrictions, error: null };
}

export const load: PageServerLoad = async ({ locals, params }) => {
  await requireAdmin(locals);
  const match_id = params.match_id;

  const matchRes = await locals.supabase
    .from('matches')
    .select('id, season_id, ruleset_id, played_at, table_label, notes, status, game_number, table_mode, extra_sticks, casual_event_id')
    .eq('id', match_id)
    .maybeSingle();

  if (matchRes.error || !matchRes.data) throw redirect(303, '/admin');

  const seasonRes = await locals.supabase
    .from('seasons')
    .select('id, name, start_date, end_date, is_casual')
    .eq('id', matchRes.data.season_id)
    .maybeSingle();
  if (seasonRes.error || !seasonRes.data) throw redirect(303, '/admin');
  const season = seasonRes.data;

  const penaltyReasonPrefix = `${CHOMBO_PREFIX}:${match_id}:%`;
  const matchDay = toArizonaDatetimeLocalValue(matchRes.data.played_at).slice(0, 10);
  const [playersRes, resultsRes, rulesetRes, lifetimeRatingsRes, eventsRes, penaltiesRes, restrictionsRes] = await Promise.all([
    locals.supabase
      .from('players')
      .select('id, display_name, real_first_name, real_last_name, show_display_name, show_real_first_name, show_real_last_name, is_active')
      .order('created_at', { ascending: true }),
    locals.supabase
      .from('match_results')
      .select('seat, player_id, raw_points, placement, club_points')
      .eq('match_id', match_id),
    locals.supabase
      .from('rulesets')
      .select('id, name, start_points, return_points, point_divisor, uma_1, uma_2, uma_3, uma_4, oka_1, oka_2, oka_3, oka_4')
      .eq('id', matchRes.data.ruleset_id)
      .maybeSingle(),
    locals.supabase
      .from('v_current_ratings')
      .select('player_id, rate, games_played')
      .eq('is_lifetime', true),
    locals.supabase.from('casual_events').select('id, name').order('name', { ascending: true }),
    locals.supabase
      .from('adjustments')
      .select('id, player_id, points, reason, created_at')
      .eq('season_id', matchRes.data.season_id)
      .eq('match_id', match_id)
      .like('reason', penaltyReasonPrefix)
      .order('created_at', { ascending: false }),
    loadEffectiveRestrictions(locals, matchDay)
  ]);

  if (restrictionsRes.error) {
    throw kitError(500, 'Could not load player eligibility.');
  }

  const restrictionByPlayerId = new Map<
    string,
    { status: 'suspension' | 'ban'; expires_on: string | null }
  >();
  for (const action of restrictionsRes.data ?? []) {
    const playerId = String(action.player_id);
    const status = action.action_type === 'ban' ? 'ban' : 'suspension';
    const existing = restrictionByPlayerId.get(playerId);
    const expiresOn = action.expires_on == null ? null : String(action.expires_on);
    const shouldReplace =
      !existing ||
      (status === 'ban' && existing.status !== 'ban') ||
      (status === 'suspension' &&
        existing.status === 'suspension' &&
        String(expiresOn ?? '') > String(existing.expires_on ?? ''));
    if (shouldReplace) {
      restrictionByPlayerId.set(playerId, {
        status,
        expires_on: expiresOn
      });
    }
  }

  const players =
    playersRes.error
      ? []
      : (playersRes.data ?? [])
          .map((p) => {
            const nameParts = composeSeasonNameParts(p);
            const restriction = restrictionByPlayerId.get(String(p.id)) ?? null;
            return {
              ...p,
              player_name_primary: nameParts.primary,
              player_name_secondary: nameParts.secondary,
              label: nameParts.secondary ? `${nameParts.primary} (${nameParts.secondary})` : nameParts.primary,
              discipline_status: restriction?.status ?? 'eligible',
              restriction_expires_on: restriction?.expires_on ?? null,
              is_competitive_ineligible: season.is_casual !== true && restriction !== null
            };
          })
          .sort((a, b) => {
            const primaryCmp = a.player_name_primary.localeCompare(b.player_name_primary);
            if (primaryCmp !== 0) return primaryCmp;
            return String(a.player_name_secondary ?? '').localeCompare(String(b.player_name_secondary ?? ''));
          });

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

  const lifetimeRatings: Array<{ player_id: string; rate: number; games_played: number }> = lifetimeRatingsRes.error
    ? []
    : (lifetimeRatingsRes.data ?? []).flatMap((row) => {
        const player_id = String(row?.player_id ?? '').trim();
        const rate = Number(row?.rate);
        const games_played = Number(row?.games_played);
        if (!player_id || !Number.isFinite(rate) || !Number.isFinite(games_played)) return [];
        return [{ player_id, rate, games_played }];
      });

  return {
    match: matchRes.data,
    season,
    players,
    results: resultsRes.error ? [] : (resultsRes.data ?? []),
    ruleset: rulesetRes.error ? null : rulesetRes.data,
    lifetimeRatings,
    casualEvents: eventsRes.error ? [] : (eventsRes.data ?? []),
    penalties
  };
};

function getStr(f: FormData, k: string) {
  return String(f.get(k) ?? '').trim();
}

function getRequiredInt(f: FormData, k: string) {
  const text = getStr(f, k);
  if (!/^-?\d+$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) ? n : null;
}

type Seat = 'E' | 'S' | 'W' | 'N';
const SEATS: Seat[] = ['E', 'S', 'W', 'N'];

async function validateDraftResults(
  locals: App.Locals,
  match_id: string,
  form: FormData,
  requireBalanced: boolean
) {
  const matchRes = await locals.supabase
    .from('matches')
    .select('id, season_id, status, ruleset_id, extra_sticks, played_at')
    .eq('id', match_id)
    .maybeSingle();

  if (matchRes.error || !matchRes.data) {
    return { ok: false as const, status: 404, message: 'Match not found.' };
  }
  if (matchRes.data.status !== 'draft') {
    return { ok: false as const, status: 409, message: 'Finalized matches cannot be edited.' };
  }

  const rows: Array<{ match_id: string; seat: Seat; player_id: string; raw_points: number }> = [];
  for (const seat of SEATS) {
    const player_id = getStr(form, `p_${seat}`);
    const raw_points = getRequiredInt(form, `raw_${seat}`);
    if (!player_id) {
      return { ok: false as const, status: 400, message: `Choose a player for seat ${seat}.` };
    }
    if (raw_points == null) {
      return { ok: false as const, status: 400, message: `Seat ${seat} points must be an integer.` };
    }
    if (raw_points <= -100_000 || raw_points >= 300_000) {
      return { ok: false as const, status: 400, message: `Seat ${seat} points are outside the allowed range.` };
    }
    rows.push({ match_id, seat, player_id, raw_points });
  }

  if (new Set(rows.map((row) => row.player_id)).size !== 4) {
    return { ok: false as const, status: 400, message: 'Players must be distinct.' };
  }

  const seasonRes = await locals.supabase
    .from('seasons')
    .select('is_casual')
    .eq('id', matchRes.data.season_id)
    .maybeSingle();
  if (seasonRes.error || !seasonRes.data) {
    return { ok: false as const, status: 400, message: 'Season not found.' };
  }

  if (!seasonRes.data.is_casual) {
    const matchDay = toArizonaDatetimeLocalValue(matchRes.data.played_at).slice(0, 10);
    const restrictionRes = await locals.supabase
      .from('discipline_actions')
      .select('player_id, action_type, expires_on')
      .in('player_id', rows.map((row) => row.player_id))
      .in('action_type', ['suspension', 'ban'])
      .is('revoked_at', null)
      .lte('effective_on', matchDay)
      .or(`expires_on.is.null,expires_on.gte.${matchDay}`)
      .limit(1);

    if (restrictionRes.error) {
      return { ok: false as const, status: 500, message: 'Could not verify player eligibility.' };
    }

    const restriction = restrictionRes.data?.[0];
    if (restriction) {
      const seat = rows.find((row) => row.player_id === restriction.player_id)?.seat;
      const description =
        restriction.action_type === 'ban'
          ? 'banned'
          : `suspended through ${String(restriction.expires_on ?? '')}`;
      return {
        ok: false as const,
        status: 409,
        message: `The player in seat ${seat ?? '?'} is ${description} and cannot play in a competitive match.`
      };
    }
  }

  if (!requireBalanced) return { ok: true as const, rows, season_id: matchRes.data.season_id };

  const rulesetRes = await locals.supabase
    .from('rulesets')
    .select('start_points')
    .eq('id', matchRes.data.ruleset_id)
    .maybeSingle();
  if (rulesetRes.error || !rulesetRes.data) {
    return { ok: false as const, status: 400, message: 'Ruleset not found.' };
  }

  const rawTotal = rows.reduce((sum, row) => sum + row.raw_points, 0);
  const expectedTotal = Number(rulesetRes.data.start_points) * 4;
  const extraPoints = Number(matchRes.data.extra_sticks ?? 0);
  if (!Number.isSafeInteger(expectedTotal) || !Number.isSafeInteger(extraPoints)) {
    return { ok: false as const, status: 400, message: 'Match scoring configuration is invalid.' };
  }
  if (rawTotal + extraPoints !== expectedTotal) {
    return {
      ok: false as const,
      status: 400,
      message: `Point total mismatch: raw points (${rawTotal}) + extra points (${extraPoints}) must equal ${expectedTotal}.`
    };
  }

  return { ok: true as const, rows, season_id: matchRes.data.season_id };
}
export const actions: Actions = {
  deleteGame: async ({ locals, params }) => {
    await requireAdmin(locals);
    const match_id = params.match_id;

    const deleteRes = await locals.supabase.rpc('delete_match_and_recompute', { p_match_id: match_id });
    if (deleteRes.error) return fail(400, { message: deleteRes.error.message });

    throw redirect(303, '/admin/matches');
  },

  saveCasualEvent: async ({ request, locals, params }) => {
    await requireAdmin(locals);
    const match_id = params.match_id;

    const matchRes = await locals.supabase
      .from('matches')
      .select('season_id')
      .eq('id', match_id)
      .maybeSingle();
    if (matchRes.error || !matchRes.data) return fail(404, { message: 'Match not found.' });

    const seasonRes = await locals.supabase
      .from('seasons')
      .select('is_casual')
      .eq('id', matchRes.data.season_id)
      .maybeSingle();
    if (seasonRes.error || !seasonRes.data?.is_casual) {
      return fail(400, { message: 'Events can only be assigned to Casual matches.' });
    }

    const form = await request.formData();
    const eventResolution = await resolveCasualEvent(
      locals,
      form.get('casual_event_id'),
      form.get('new_casual_event_name')
    );
    if (!eventResolution.ok) return fail(400, { message: eventResolution.message });

    const updateRes = await locals.supabase.rpc('set_casual_match_event', {
      p_match_id: match_id,
      p_casual_event_id: eventResolution.eventId
    });
    if (updateRes.error) return fail(400, { message: updateRes.error.message });

    return { message: 'Casual event updated.' };
  },

  saveMatchMeta: async ({ request, locals, params }) => {
    await requireAdmin(locals);
    const match_id = params.match_id;

    const currentMatchRes = await locals.supabase
      .from('matches')
      .select('id, season_id, status, played_at, game_number, table_mode, casual_event_id')
      .eq('id', match_id)
      .maybeSingle();
    if (currentMatchRes.error || !currentMatchRes.data) return fail(404, { message: 'Match not found.' });
    if (currentMatchRes.data.status !== 'draft') {
      return fail(409, { message: 'Finalized matches cannot be edited.' });
    }

    const f = await request.formData();
    const played_at_input = getStr(f, 'played_at');
    const table_mode_raw = getStr(f, 'table_mode').toUpperCase();
    const ex_raw = getStr(f, 'extra_sticks');
    const notes = getStr(f, 'notes');
    const seasonRes = await locals.supabase
      .from('seasons')
      .select('is_casual')
      .eq('id', currentMatchRes.data.season_id)
      .maybeSingle();
    if (seasonRes.error || !seasonRes.data) return fail(400, { message: 'Season not found.' });

    let casual_event_id: string | null = null;

    if (!played_at_input) return fail(400, { message: 'Played at is required.' });
    const played_at = parseArizonaLocalDatetimeToUtcIso(played_at_input);
    const dayBounds = parseArizonaDayBoundsFromDatetimeLocal(played_at_input);
    if (!played_at || !dayBounds) {
      return fail(400, { message: 'Played at must be a valid date/time.' });
    }

    const table_mode = table_mode_raw;
    if (table_mode !== 'A' && table_mode !== 'M') {
      return fail(400, { message: 'Tbl must be A or M.' });
    }

    const currentDay = toArizonaDatetimeLocalValue(currentMatchRes.data.played_at).slice(0, 10);
    const nextDay = played_at_input.slice(0, 10);
    const currentGameNumber = Number(currentMatchRes.data.game_number);
    let game_number = Number.isInteger(currentGameNumber) && currentGameNumber > 0 ? currentGameNumber : 1;

    if (currentDay !== nextDay || currentMatchRes.data.table_mode !== table_mode || !Number.isInteger(currentGameNumber)) {
      const dayMatchesRes = await locals.supabase
        .from('matches')
        .select('game_number')
        .eq('season_id', currentMatchRes.data.season_id)
        .gte('played_at', dayBounds.dayStart)
        .lt('played_at', dayBounds.dayEnd)
        .eq('table_mode', table_mode)
        .neq('id', match_id);
      if (dayMatchesRes.error) return fail(400, { message: dayMatchesRes.error.message });
      game_number =
        Math.max(
          0,
          ...(dayMatchesRes.data ?? [])
            .map((row) => Number(row.game_number))
            .filter((value) => Number.isInteger(value) && value > 0)
        ) + 1;
      if (!Number.isSafeInteger(game_number) || game_number > 2_147_483_647) {
        return fail(400, { message: 'Could not allocate a valid game number.' });
      }
    }
    const table_label = `${table_mode}-${game_number}`;

    const extra_sticks = ex_raw === '' || /^\d+$/.test(ex_raw) ? Number(ex_raw || '0') : Number.NaN;
    if (!Number.isSafeInteger(extra_sticks) || extra_sticks < 0 || extra_sticks > 2_147_483_647) {
      return fail(400, { message: 'Ex must be an integer >= 0.' });
    }

    if (seasonRes.data.is_casual) {
      const eventResolution = await resolveCasualEvent(
        locals,
        f.get('casual_event_id'),
        f.get('new_casual_event_name')
      );
      if (!eventResolution.ok) return fail(400, { message: eventResolution.message });
      casual_event_id = eventResolution.eventId;
    }

    const { error } = await locals.supabase
      .from('matches')
      .update({
        played_at,
        table_label,
        game_number,
        table_mode,
        extra_sticks,
        notes: notes || null,
        casual_event_id
      })
      .eq('id', match_id);

    if (error) return fail(400, { message: error.message });
    return { message: 'Match details updated.' };
  },

  saveResults: async ({ request, locals, params }) => {
    await requireAdmin(locals);
    const match_id = params.match_id;

    const f = await request.formData();
    const validated = await validateDraftResults(locals, match_id, f, false);
    if (!validated.ok) return fail(validated.status, { message: validated.message });

    const { error } = await locals.supabase
      .from('match_results')
      .upsert(validated.rows, { onConflict: 'match_id,seat' });

    if (error) return fail(400, { message: error.message });
    return { message: 'Saved.' };
  },

  addPenalty: async ({ request, locals, params }) => {
    await requireAdmin(locals);
    const match_id = params.match_id;
    const f = await request.formData();

    const player_id = getStr(f, 'player_id');
    const points = getRequiredInt(f, 'points');
    const reason_code = getStr(f, 'reason_code').toUpperCase();

    if (!player_id) return fail(400, { message: 'Choose a player for penalty.' });
    if (!reason_code) return fail(400, { message: 'Reason code is required.' });
    if (!/^[A-Z0-9_-]{1,40}$/.test(reason_code)) {
      return fail(400, { message: 'Reason code can use A-Z, 0-9, _ and - only (max 40 chars).' });
    }
    if (points == null || points === 0) {
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
      match_id,
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
      .eq('match_id', match_id)
      .like('reason', reasonLike);

    if (delRes.error) return fail(400, { message: delRes.error.message });
    return { message: 'Penalty removed.' };
  },

  finalize: async ({ request, locals, params }) => {
    await requireAdmin(locals);
    const match_id = params.match_id;

    const form = await request.formData();
    const validated = await validateDraftResults(locals, match_id, form, true);
    if (!validated.ok) return fail(validated.status, { message: validated.message });

    const saveRes = await locals.supabase
      .from('match_results')
      .upsert(validated.rows, { onConflict: 'match_id,seat' });
    if (saveRes.error) return fail(400, { message: saveRes.error.message });

    const seasonRes = await locals.supabase
      .from('seasons')
      .select('is_casual')
      .eq('id', validated.season_id)
      .maybeSingle();
    if (seasonRes.error || !seasonRes.data) return fail(400, { message: 'Season not found.' });

    const { error } = await locals.supabase.rpc('finalize_match', {
      p_match_id: match_id,
      p_update_lifetime: !seasonRes.data.is_casual
    });
    if (error) return fail(400, { message: error.message });

    throw redirect(303, `/admin/match/${match_id}`);
  }
};
