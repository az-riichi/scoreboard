import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

function respond(canEditDisplay: boolean, editablePlayer: unknown = null) {
  return json({ canEditDisplay, editablePlayer }, { headers: { 'cache-control': 'private, no-store' } });
}

// Resolves private editable name values for the signed-in owner of a profile.
export const GET: RequestHandler = async ({ locals, params }) => {
  if (!locals.userId) return respond(false);

  const ownership = await locals.supabase
    .from('player_accounts')
    .select('player_id')
    .eq('auth_user_id', locals.userId)
    .eq('player_id', params.player_id)
    .maybeSingle();
  if (ownership.error || !ownership.data) return respond(false);

  const player = await locals.supabase
    .from('players')
    .select('id, display_name, real_first_name, real_last_name')
    .eq('id', params.player_id)
    .maybeSingle();

  return respond(!player.error && !!player.data, player.error ? null : player.data);
};
