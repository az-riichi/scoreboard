import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createAdminAccess } from '$lib/permissions';
import { sanitizeLocalRedirect } from '$lib/server/safe-redirect';

function asText(value: unknown) {
  return String(value ?? '').trim();
}

async function getSignedInRedirect(locals: App.Locals, userId: string | null | undefined) {
  if (!userId) return '/';

  const profileRes = await locals.supabase
    .from('profiles')
    .select('admin_role, admin_permissions')
    .eq('id', userId)
    .maybeSingle();
  const access = createAdminAccess(
    profileRes.data?.admin_role,
    profileRes.data?.admin_permissions
  );
  return access.isAdmin ? '/admin' : '/';
}

export const load: PageServerLoad = async ({ locals, url }) => {
  const next = sanitizeLocalRedirect(url.searchParams.get('next'));
  if (locals.user) throw redirect(303, next ?? (await getSignedInRedirect(locals, locals.userId)));
  return { next };
};

export const actions: Actions = {
  signIn: async ({ request, locals }) => {
    const form = await request.formData();
    const email = asText(form.get('signin-email'));
    const password = String(form.get('signin-password') ?? '');
    const next = sanitizeLocalRedirect(form.get('next'));

    if (!email || !password) return fail(400, { message: 'Missing email or password.' });

    const { data, error } = await locals.supabase.auth.signInWithPassword({ email, password });
    if (error) return fail(400, { message: error.message });

    throw redirect(303, next ?? (await getSignedInRedirect(locals, data.user?.id)));
  },

  signUp: async ({ request, locals }) => {
    const form = await request.formData();
    const email = asText(form.get('signup-email'));
    const password = String(form.get('signup-password') ?? '');
    const next = sanitizeLocalRedirect(form.get('next'));

    if (!email || !password) return fail(400, { message: 'Missing email or password.' });

    const { data, error } = await locals.supabase.auth.signUp({ email, password });
    if (error) return fail(400, { message: error.message });

    if (!data.session) return { message: 'Account created. Check your email to confirm, then sign in.' };

    throw redirect(303, next ?? (await getSignedInRedirect(locals, data.user?.id)));
  }
};
