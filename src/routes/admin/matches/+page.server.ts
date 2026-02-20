import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireAdmin } from '$lib/server/admin';

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
    .select('id, played_at, table_label, season_id, status, game_number, table_mode, extra_sticks')
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
  create: async ({ request, locals }) => {
    await requireAdmin(locals);
    const f = await request.formData();
    const season_id = String(f.get('season_id') ?? '').trim();
    const ruleset_id = String(f.get('ruleset_id') ?? '').trim();
    const played_at = String(f.get('played_at') ?? '').trim();
    const table_label = String(f.get('table_label') ?? '').trim();
    const game_raw = String(f.get('game_number') ?? '').trim();
    const table_mode_raw = String(f.get('table_mode') ?? '').trim().toUpperCase();
    const extra_raw = String(f.get('extra_sticks') ?? '').trim();

    if (!season_id || !ruleset_id || !played_at) return fail(400, { message: 'Missing fields.' });

    const game_number = game_raw ? Number(game_raw) : null;
    if (game_raw && (game_number === null || !Number.isInteger(game_number) || game_number <= 0)) {
      return fail(400, { message: 'Game number must be a positive integer.' });
    }

    const table_mode = table_mode_raw || null;
    if (table_mode && table_mode !== 'A' && table_mode !== 'M') {
      return fail(400, { message: 'Tbl must be A or M.' });
    }

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
        table_label: table_label || null,
        created_by: locals.userId
      })
      .select('id')
      .single();

    if (error) return fail(400, { message: error.message });

    throw redirect(303, `/admin/match/${data.id}`);
  }
};
