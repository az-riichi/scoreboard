import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireAdmin } from '$lib/server/admin';
import {
  parseArizonaDayBoundsFromDatetimeLocal,
  parseArizonaLocalDatetimeToUtcIso
} from '$lib/arizona-time';
import { resolveCasualEvent } from '$lib/server/casual-events';

export const load: PageServerLoad = async ({ locals }) => {
  await requireAdmin(locals);

  const [seasonsRes, rulesRes, eventsRes, recentRes] = await Promise.all([
    locals.supabase
      .from('seasons')
      .select('id, name, is_active, is_casual, start_date, end_date')
      .order('is_casual', { ascending: false })
      .order('start_date', { ascending: false, nullsFirst: false }),
    locals.supabase.from('rulesets').select('id, name').order('name', { ascending: true }),
    locals.supabase.from('casual_events').select('id, name').order('name', { ascending: true }),
    locals.supabase
      .from('matches')
      .select('id, played_at, season_id, status, game_number, table_mode, extra_sticks, casual_event_id')
      .order('played_at', { ascending: false })
      .limit(30)
  ]);

  const seasons = seasonsRes.error ? [] : (seasonsRes.data ?? []);
  const activeSeason =
    seasons.find((s) => s.is_active && !s.is_casual)?.id ??
    seasons.find((s) => !s.is_casual)?.id ??
    seasons[0]?.id ??
    null;
  const defaultRules = rulesRes.data?.[0]?.id ?? null;
  const seasonById = new Map(seasons.map((season) => [season.id, season]));
  const eventNameById = new Map((eventsRes.data ?? []).map((event) => [event.id, event.name]));
  const recentMatches = recentRes.error
    ? []
    : (recentRes.data ?? []).map((match) => {
        const season = seasonById.get(match.season_id);
        return {
          ...match,
          season_name: season?.name ?? 'Unknown season',
          is_casual: season?.is_casual === true,
          casual_event_name: match.casual_event_id
            ? (eventNameById.get(match.casual_event_id) ?? 'Unknown event')
            : null
        };
      });

  return {
    seasons,
    rulesets: rulesRes.error ? [] : (rulesRes.data ?? []),
    casualEvents: eventsRes.error ? [] : (eventsRes.data ?? []),
    activeSeason,
    defaultRules,
    recentMatches
  };
};

export const actions: Actions = {
  recomputeLifetimeR: async ({ locals }) => {
    await requireAdmin(locals);
    const recomputeRes = await locals.supabase.rpc('recompute_all_ratings');
    if (recomputeRes.error) return fail(400, { message: recomputeRes.error.message });
    return { message: 'Season and lifetime ratings recomputed.' };
  },

  delete: async ({ request, locals }) => {
    await requireAdmin(locals);
    const f = await request.formData();
    const match_id = String(f.get('match_id') ?? '').trim();
    if (!match_id) return fail(400, { message: 'Missing match id.' });

    const deleteRes = await locals.supabase.rpc('delete_match_and_recompute', { p_match_id: match_id });
    if (deleteRes.error) return fail(400, { message: deleteRes.error.message });

    return { message: 'Game deleted.' };
  },

  create: async ({ request, locals }) => {
    await requireAdmin(locals);
    const f = await request.formData();
    const season_id = String(f.get('season_id') ?? '').trim();
    const ruleset_id = String(f.get('ruleset_id') ?? '').trim();
    const played_at_input = String(f.get('played_at') ?? '').trim();
    const table_mode_raw = String(f.get('table_mode') ?? '').trim().toUpperCase();
    const extra_raw = String(f.get('extra_sticks') ?? '').trim();
    const notes = String(f.get('notes') ?? '').trim();

    if (!season_id || !ruleset_id || !played_at_input) return fail(400, { message: 'Missing fields.' });

    const seasonRes = await locals.supabase
      .from('seasons')
      .select('id, is_casual')
      .eq('id', season_id)
      .maybeSingle();
    if (seasonRes.error || !seasonRes.data) return fail(400, { message: 'Season not found.' });
    const isCasual = seasonRes.data.is_casual === true;
    let casual_event_id: string | null = null;

    const played_at = parseArizonaLocalDatetimeToUtcIso(played_at_input);
    const dayBounds = parseArizonaDayBoundsFromDatetimeLocal(played_at_input);
    if (!played_at || !dayBounds) {
      return fail(400, { message: 'Played at must be a valid date/time.' });
    }

    const table_mode = table_mode_raw;
    if (table_mode !== 'A' && table_mode !== 'M') {
      return fail(400, { message: 'Tbl must be A or M.' });
    }

    const dayMatchesRes = await locals.supabase
      .from('matches')
      .select('game_number')
      .eq('season_id', season_id)
      .gte('played_at', dayBounds.dayStart)
      .lt('played_at', dayBounds.dayEnd)
      .eq('table_mode', table_mode);
    if (dayMatchesRes.error) return fail(400, { message: dayMatchesRes.error.message });
    const game_number =
      Math.max(
        0,
        ...(dayMatchesRes.data ?? [])
          .map((row) => Number(row.game_number))
          .filter((value) => Number.isInteger(value) && value > 0)
      ) + 1;
    if (!Number.isSafeInteger(game_number) || game_number > 2_147_483_647) {
      return fail(400, { message: 'Could not allocate a valid game number.' });
    }
    const table_label = `${table_mode}-${game_number}`;

    const extra_sticks = extra_raw === '' || /^\d+$/.test(extra_raw) ? Number(extra_raw || '0') : Number.NaN;
    if (!Number.isSafeInteger(extra_sticks) || extra_sticks < 0 || extra_sticks > 2_147_483_647) {
      return fail(400, { message: 'Ex must be an integer >= 0.' });
    }

    if (isCasual) {
      const eventResolution = await resolveCasualEvent(
        locals,
        f.get('casual_event_id'),
        f.get('new_casual_event_name')
      );
      if (!eventResolution.ok) return fail(400, { message: eventResolution.message });
      casual_event_id = eventResolution.eventId;
    }

    const { data, error } = await locals.supabase
      .from('matches')
      .insert({
        season_id,
        ruleset_id,
        game_number,
        table_mode,
        extra_sticks,
        played_at,
        table_label,
        notes: notes || null,
        casual_event_id,
        include_in_lifetime_rating: !isCasual,
        created_by: locals.userId
      })
      .select('id')
      .single();

    if (error) return fail(400, { message: error.message });

    throw redirect(303, `/admin/match/${data.id}`);
  }
};
