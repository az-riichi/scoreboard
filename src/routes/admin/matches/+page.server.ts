import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireAdmin } from '$lib/server/admin';

const CHOMBO_PREFIX = 'CHOMBO';

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

export const load: PageServerLoad = async ({ locals }) => {
  await requireAdmin(locals);

  const seasonsRes = await locals.supabase
    .from('seasons')
    .select('id, name, is_active, start_date')
    .order('start_date', { ascending: false });

  const rulesRes = await locals.supabase
    .from('rulesets')
    .select('id, name')
    .order('name', { ascending: true });

  const recentRes = await locals.supabase
    .from('matches')
    .select('id, played_at, season_id, status, game_number, table_mode, extra_sticks')
    .order('played_at', { ascending: false })
    .limit(30);

  const activeSeason = seasonsRes.data?.find((s) => s.is_active)?.id ?? seasonsRes.data?.[0]?.id ?? null;
  const defaultRules = rulesRes.data?.[0]?.id ?? null;

  return {
    seasons: seasonsRes.error ? [] : (seasonsRes.data ?? []),
    rulesets: rulesRes.error ? [] : (rulesRes.data ?? []),
    activeSeason,
    defaultRules,
    recentMatches: recentRes.error ? [] : (recentRes.data ?? [])
  };
};

export const actions: Actions = {
  recomputeLifetimeR: async ({ locals }) => {
    await requireAdmin(locals);
    const lifetimeRecompute = await locals.supabase.rpc('recompute_lifetime_ratings');
    if (lifetimeRecompute.error) return fail(400, { message: lifetimeRecompute.error.message });
    return { message: 'Lifetime Rating (R) recomputed.' };
  },

  delete: async ({ request, locals }) => {
    await requireAdmin(locals);
    const f = await request.formData();
    const match_id = String(f.get('match_id') ?? '').trim();
    if (!match_id) return fail(400, { message: 'Missing match id.' });

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

    return { message: 'Game deleted.' };
  },

  create: async ({ request, locals }) => {
    await requireAdmin(locals);
    const f = await request.formData();
    const season_id = String(f.get('season_id') ?? '').trim();
    const ruleset_id = String(f.get('ruleset_id') ?? '').trim();
    const played_at = String(f.get('played_at') ?? '').trim();
    const table_mode_raw = String(f.get('table_mode') ?? '').trim().toUpperCase();
    const extra_raw = String(f.get('extra_sticks') ?? '').trim();
    const notes = String(f.get('notes') ?? '').trim();

    if (!season_id || !ruleset_id || !played_at) return fail(400, { message: 'Missing fields.' });

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
      .lt('played_at', dayBounds.dayEnd);
    if (dayCountRes.error) return fail(400, { message: dayCountRes.error.message });
    const game_number = (dayCountRes.count ?? 0) + 1;
    const table_label = `${table_mode}-${game_number}`;

    const extra_sticks = extra_raw === '' ? 0 : Number(extra_raw);
    if (!Number.isInteger(extra_sticks) || extra_sticks < 0) {
      return fail(400, { message: 'Ex must be an integer >= 0.' });
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
        created_by: locals.userId
      })
      .select('id')
      .single();

    if (error) return fail(400, { message: error.message });

    throw redirect(303, `/admin/match/${data.id}`);
  }
};
