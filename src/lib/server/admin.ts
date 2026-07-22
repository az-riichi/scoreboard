import { redirect } from '@sveltejs/kit';

const adminLookupByRequest = new WeakMap<App.Locals, Promise<boolean>>();

export function getIsAdmin(locals: App.Locals): Promise<boolean> {
  if (!locals.user || !locals.userId) return Promise.resolve(false);

  const existing = adminLookupByRequest.get(locals);
  if (existing) return existing;

  const lookup = (async () => {
    const { data, error } = await locals.supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', locals.userId)
      .maybeSingle();
    return !error && !!data?.is_admin;
  })();
  adminLookupByRequest.set(locals, lookup);
  return lookup;
}

export async function requireAdmin(locals: App.Locals) {
  if (!locals.user || !locals.userId) throw redirect(303, '/login');

  if (!(await getIsAdmin(locals))) throw redirect(303, '/');
}
