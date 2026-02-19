import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireAdmin } from '$lib/server/admin';

export const load: PageServerLoad = async ({ locals, params }) => {
  await requireAdmin(locals);
  const match_id = params.match_id;

  const matchRes = await locals.supabase
    .from('matches')
    .select('id, season_id, ruleset_id, played_at, table_label, notes, status')
    .eq('id', match_id)
    .maybeSingle();

  if (matchRes.error || !matchRes.data) throw redirect(303, '/admin');

  const playersRes = await locals.supabase
    .from('players')
    .select('id, display_name')
    .eq('is_active', true)
    .order('display_name', { ascending: true });

  const resultsRes = await locals.supabase
    .from('match_results')
    .select('seat, player_id, raw_points, placement, club_points')
    .eq('match_id', match_id);

  return {
    match: matchRes.data,
    players: playersRes.error ? [] : (playersRes.data ?? []),
    results: resultsRes.error ? [] : (resultsRes.data ?? [])
  };
};

function getStr(f: FormData, k: string) {
  return String(f.get(k) ?? '').trim();
}
function getInt(f: FormData, k: string) {
  const n = Number(f.get(k));
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

export const actions: Actions = {
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

  recompute: async ({ locals, params }) => {
    await requireAdmin(locals);
    const match_id = params.match_id;

    const { error } = await locals.supabase.rpc('recompute_match_derived', { p_match_id: match_id });
    if (error) return fail(400, { message: error.message });
    return { message: 'Recomputed placement and club points.' };
  },

  finalize: async ({ locals, params }) => {
    await requireAdmin(locals);
    const match_id = params.match_id;

    const { error } = await locals.supabase.rpc('finalize_match', { p_match_id: match_id, p_update_lifetime: true });
    if (error) return fail(400, { message: error.message });

    throw redirect(303, `/admin/match/${match_id}`);
  }
};
