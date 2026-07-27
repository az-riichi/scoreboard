import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import { getPublicSnapshot } from '$lib/public-data/cache';
import { derivePlayerPage } from '$lib/public-data/derive';

export const load: PageLoad = async ({ data, parent, params, url }) => {
  await parent();
  const pageData = derivePlayerPage(
    await getPublicSnapshot({ check: false }),
    params.player_id,
    {
      seasonId: url.searchParams.get('season'),
      eventId: url.searchParams.get('event')
    }
  );

  if (!pageData) throw error(404, 'Player not found');

  const editablePlayer = data.editablePlayer;
  return {
    ...pageData,
    canEditDisplay: data.canEditDisplay === true,
    player:
      data.canEditDisplay && editablePlayer
        ? {
            ...pageData.player,
            display_name: editablePlayer.display_name,
            real_first_name: editablePlayer.real_first_name,
            real_last_name: editablePlayer.real_last_name
          }
        : pageData.player
  };
};
