import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

function asText(value: unknown) {
  return String(value ?? '').trim();
}

function sanitizeNextPath(value: unknown): string | null {
  const next = asText(value);
  if (!next.startsWith('/')) return null;
  if (next.startsWith('//')) return null;
  return next;
}

async function getSignedInRedirect(locals: App.Locals, userId: string | null | undefined) {
  if (!userId) return '/';

  const profileRes = await locals.supabase.from('profiles').select('is_admin').eq('id', userId).maybeSingle();
  return profileRes.data?.is_admin ? '/admin' : '/';
}

export const load: PageServerLoad = async ({ locals, url }) => {
  const next = sanitizeNextPath(url.searchParams.get('next'));
  if (locals.user) throw redirect(303, next ?? (await getSignedInRedirect(locals, locals.userId)));
  return { next };
};

export const actions: Actions = {
  signIn: async ({ request, locals }) => {
    const form = await request.formData();
    const email = asText(form.get('signin-email'));
    const password = String(form.get('signin-password') ?? '');
    const next = sanitizeNextPath(form.get('next'));

    if (!email || !password) return fail(400, { message: 'Missing email or password.' });

    const { data, error } = await locals.supabase.auth.signInWithPassword({ email, password });
    if (error) return fail(400, { message: error.message });

    throw redirect(303, next ?? (await getSignedInRedirect(locals, data.user?.id)));
  },

  signUp: async ({ request, locals }) => {
    const form = await request.formData();
    const email = asText(form.get('signup-email'));
    const password = String(form.get('signup-password') ?? '');
    const next = sanitizeNextPath(form.get('next'));

    if (!email || !password) return fail(400, { message: 'Missing email or password.' });

    const { data, error } = await locals.supabase.auth.signUp({ email, password });
    if (error) return fail(400, { message: error.message });

    if (!data.session) return { message: 'Account created. Check your email to confirm, then sign in.' };

    throw redirect(303, next ?? (await getSignedInRedirect(locals, data.user?.id)));
  }
};
