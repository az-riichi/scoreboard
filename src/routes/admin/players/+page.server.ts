import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireAdmin } from '$lib/server/admin';

export const load: PageServerLoad = async ({ locals }) => {
  await requireAdmin(locals);

  const playersRes = await locals.supabase
    .from('players')
    .select('id, display_name, is_active, created_at')
    .order('display_name', { ascending: true });

  return { players: playersRes.error ? [] : (playersRes.data ?? []) };
};

export const actions: Actions = {
  create: async ({ request, locals }) => {
    await requireAdmin(locals);
    const f = await request.formData();
    const display_name = String(f.get('display_name') ?? '').trim();
    if (!display_name) return fail(400, { message: 'Missing display name.' });

    const { error } = await locals.supabase.from('players').insert({ display_name });
    if (error) return fail(400, { message: error.message });

    return { message: 'Player created.' };
  }
};
