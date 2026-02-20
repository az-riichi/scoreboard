import { error as kitError, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { composePlayerDisplayName } from '$lib/player-name';

function asText(value: unknown) {
  return String(value ?? '').trim();
}

function asBool(value: unknown) {
  return String(value ?? '') === 'on';
}

export const load: PageServerLoad = async ({ locals, params, url }) => {
  const player_id = params.player_id;
  const seasonParam = url.searchParams.get('season');

  const playerRes = await locals.supabase
    .from('players')
    .select('id, display_name, real_first_name, real_last_name, show_display_name, show_real_first_name, show_real_last_name, is_active')
    .eq('id', player_id)
    .maybeSingle();

  if (playerRes.error || !playerRes.data) throw kitError(404, 'Player not found');

  let canEditDisplay = false;
  if (locals.userId) {
    const ownRes = await locals.supabase
      .from('player_accounts')
      .select('auth_user_id')
      .eq('auth_user_id', locals.userId)
      .eq('player_id', player_id)
      .maybeSingle();
    canEditDisplay = !!ownRes.data && !ownRes.error;
  }

  const player = {
    ...playerRes.data,
    public_name: composePlayerDisplayName(playerRes.data)
  };

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
    player,
    canEditDisplay,
    seasons: seasonsRes.error ? [] : (seasonsRes.data ?? []),
    seasonId,
    stats,
    standingsRow,
    matchHistory,
    pointHistory,
    ratingHistory
  };
};

export const actions: Actions = {
  updateDisplay: async ({ request, locals, params }) => {
    if (!locals.userId || !locals.session) return fail(401, { message: 'Sign in to update your display settings.' });

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
