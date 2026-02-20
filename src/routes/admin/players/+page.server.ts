import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireAdmin } from '$lib/server/admin';
import { composePlayerDisplayName } from '$lib/player-name';

function asText(value: unknown) {
  return String(value ?? '').trim();
}

function asBool(value: unknown) {
  return String(value ?? '') === 'on';
}

export const load: PageServerLoad = async ({ locals }) => {
  await requireAdmin(locals);

  const playersRes = await locals.supabase
    .from('players')
    .select('id, display_name, real_first_name, real_last_name, show_display_name, show_real_first_name, show_real_last_name, is_active, created_at')
    .order('created_at', { ascending: false });

  return {
    players: playersRes.error
      ? []
      : (playersRes.data ?? [])
          .map((p) => ({ ...p, public_name: composePlayerDisplayName(p) }))
          .sort((a, b) => a.public_name.localeCompare(b.public_name))
  };
};

export const actions: Actions = {
  create: async ({ request, locals }) => {
    await requireAdmin(locals);
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
      return fail(400, { message: 'Enable at least one display option: Display name or Real first name.' });
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

    const { error } = await locals.supabase.from('players').insert({
      display_name,
      real_first_name,
      real_last_name,
      show_display_name,
      show_real_first_name,
      show_real_last_name
    });
    if (error) return fail(400, { message: error.message });

    return { message: 'Player created.' };
  }
};
