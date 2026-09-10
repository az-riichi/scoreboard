import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const INVALID_LINK_MESSAGE =
  'This password reset link is invalid or has expired. Request a new link from the sign-in page.';

export const load: PageServerLoad = async ({ locals, url }) => {
  const code = url.searchParams.get('code');

  if (code) {
    const { error } = await locals.supabase.auth.exchangeCodeForSession(code);
    if (error) return { canReset: false, message: INVALID_LINK_MESSAGE };

    throw redirect(303, '/reset-password');
  }

  return {
    canReset: Boolean(locals.user),
    message: locals.user ? null : INVALID_LINK_MESSAGE
  };
};

export const actions: Actions = {
  updatePassword: async ({ request, locals }) => {
    if (!locals.user) {
      return fail(401, { ok: false, message: INVALID_LINK_MESSAGE });
    }

    const form = await request.formData();
    const password = String(form.get('password') ?? '');
    const passwordConfirmation = String(form.get('password-confirmation') ?? '');

    if (!password || !passwordConfirmation) {
      return fail(400, { ok: false, message: 'Enter and confirm your new password.' });
    }
    if (password !== passwordConfirmation) {
      return fail(400, { ok: false, message: 'The passwords do not match.' });
    }

    const { error } = await locals.supabase.auth.updateUser({ password });
    if (error) return fail(400, { ok: false, message: error.message });

    const { error: signOutError } = await locals.supabase.auth.signOut({ scope: 'local' });
    if (signOutError) {
      return {
        ok: true,
        message: 'Your password has been updated. You can continue using your account.'
      };
    }

    throw redirect(303, '/login?passwordReset=1');
  }
};
