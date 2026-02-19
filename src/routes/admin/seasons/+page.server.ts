import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireAdmin } from '$lib/server/admin';

export const load: PageServerLoad = async ({ locals }) => {
  await requireAdmin(locals);

  const seasonsRes = await locals.supabase
    .from('seasons')
    .select('id, name, start_date, end_date, is_active')
    .order('start_date', { ascending: false });

  return { seasons: seasonsRes.error ? [] : (seasonsRes.data ?? []) };
};

export const actions: Actions = {
  create: async ({ request, locals }) => {
    await requireAdmin(locals);
    const f = await request.formData();
    const name = String(f.get('name') ?? '').trim();
    const start_date = String(f.get('start_date') ?? '').trim();
    const end_date = String(f.get('end_date') ?? '').trim();
    const is_active = String(f.get('is_active') ?? '') === 'on';

    if (!name || !start_date || !end_date) return fail(400, { message: 'Missing fields.' });

    if (is_active) {
      await locals.supabase.from('seasons').update({ is_active: false }).neq('id', '00000000-0000-0000-0000-000000000000');
    }

    const { error } = await locals.supabase.from('seasons').insert({ name, start_date, end_date, is_active });
    if (error) return fail(400, { message: error.message });

    return { message: 'Season created.' };
  }
};
