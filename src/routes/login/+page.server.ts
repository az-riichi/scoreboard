import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.session) throw redirect(303, '/admin');
  return {};
};

export const actions: Actions = {
  signIn: async ({ request, locals }) => {
    const form = await request.formData();
    const email = String(form.get('email') ?? '').trim();
    const password = String(form.get('password') ?? '');

    if (!email || !password) return fail(400, { message: 'Missing email or password.' });

    const { error } = await locals.supabase.auth.signInWithPassword({ email, password });
    if (error) return fail(400, { message: error.message });

    throw redirect(303, '/admin');
  },

  signUp: async ({ request, locals }) => {
    const form = await request.formData();
    const email = String(form.get('email') ?? '').trim();
    const password = String(form.get('password') ?? '');

    if (!email || !password) return fail(400, { message: 'Missing email or password.' });

    const { data, error } = await locals.supabase.auth.signUp({ email, password });
    if (error) return fail(400, { message: error.message });

    if (!data.session) return { message: 'Account created. Check your email to confirm, then sign in.' };

    throw redirect(303, '/admin');
  }
};
