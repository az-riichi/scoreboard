import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import { derivePublicPage } from '$lib/public-data/cache';
import { derivePlayerPage } from '$lib/public-data/derive';
import { hasAuthCookie } from '$lib/session';

type EditablePlayer = {
  display_name: string | null;
  real_first_name: string | null;
  real_last_name: string | null;
};
type PlayerEditAccess = { canEditDisplay: boolean; editablePlayer: EditablePlayer | null };

const NO_EDIT_ACCESS: PlayerEditAccess = { canEditDisplay: false, editablePlayer: null };

// Public profile data comes from the browser's redacted snapshot. Only someone
// signed in can own this profile, so nobody else waits on the server for this.
async function loadEditAccess(load: typeof fetch, playerId: string): Promise<PlayerEditAccess> {
  if (!hasAuthCookie()) return NO_EDIT_ACCESS;
  try {
    const response = await load(`/api/player-edit-access/${encodeURIComponent(playerId)}`);
    return response.ok ? await response.json() : NO_EDIT_ACCESS;
  } catch {
    return NO_EDIT_ACCESS;
  }
}

export const load: PageLoad = async ({ fetch, parent, params, url }) => {
  await parent();
  const pageData = await derivePublicPage((snapshot) =>
    derivePlayerPage(snapshot, params.player_id, {
      seasonId: url.searchParams.get('season'),
      eventId: url.searchParams.get('event')
    })
  );

  if (!pageData) throw error(404, 'Player not found');

  const { canEditDisplay, editablePlayer } = await loadEditAccess(fetch, params.player_id);
  return {
    ...pageData,
    canEditDisplay,
    player:
      canEditDisplay && editablePlayer
        ? {
            ...pageData.player,
            display_name: editablePlayer.display_name,
            real_first_name: editablePlayer.real_first_name,
            real_last_name: editablePlayer.real_last_name
          }
        : pageData.player
  };
};
