import { redirect } from '@sveltejs/kit';

export async function requireAdmin(locals: App.Locals) {
  if (!locals.session || !locals.userId) throw redirect(303, '/login');

  const { data, error } = await locals.supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', locals.userId)
    .maybeSingle();

  if (error || !data?.is_admin) throw redirect(303, '/');
}
