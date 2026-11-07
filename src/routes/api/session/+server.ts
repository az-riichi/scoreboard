import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAdminAccess } from '$lib/server/admin';

export const GET: RequestHandler = async ({ locals }) => {
  const { isAdmin } = await getAdminAccess(locals);
  return json(
    { signedIn: Boolean(locals.user), isAdmin },
    { headers: { 'cache-control': 'private, no-store' } }
  );
};
