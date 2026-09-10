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
  const notice = url.searchParams.get('passwordReset') === '1' ? 'Your password has been updated. Sign in with your new password.' : null;
  return { next, notice };
};

export const actions: Actions = {
  signIn: async ({ request, locals }) => {
    const form = await request.formData();
    const email = asText(form.get('signin-email'));
    const password = String(form.get('signin-password') ?? '');
    const next = sanitizeLocalRedirect(form.get('next'));

    if (!email || !password) return fail(400, { ok: false, message: 'Missing email or password.' });

    const { data, error } = await locals.supabase.auth.signInWithPassword({ email, password });
    if (error) return fail(400, { ok: false, message: error.message });

    throw redirect(303, next ?? (await getSignedInRedirect(locals, data.user?.id)));
  },

  signUp: async ({ request, locals }) => {
    const form = await request.formData();
    const email = asText(form.get('signup-email'));
    const password = String(form.get('signup-password') ?? '');
    const next = sanitizeLocalRedirect(form.get('next'));

    if (!email || !password) return fail(400, { ok: false, message: 'Missing email or password.' });

    const { data, error } = await locals.supabase.auth.signUp({ email, password });
    if (error) return fail(400, { ok: false, message: error.message });

    if (!data.session) return { ok: true, message: 'Account created. Check your email to confirm, then sign in.' };

    throw redirect(303, next ?? (await getSignedInRedirect(locals, data.user?.id)));
  },

  requestPasswordReset: async ({ request, locals, url }) => {
    const form = await request.formData();
    const email = asText(form.get('reset-email'));

    if (!email) return fail(400, { ok: false, message: 'Enter your email address.' });

    const redirectTo = new URL('/reset-password', url.origin).toString();
    const { error } = await locals.supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) {
      return fail(400, {
        ok: false,
        message: 'Could not send a reset email. Please wait a moment and try again.'
      });
    }

    return {
      ok: true,
      message:
        'If an account exists for that email, a password reset link has been sent. Open the newest link in this browser.'
    };
  }
};
