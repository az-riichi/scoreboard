import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import { getPublicSnapshot } from '$lib/public-data/cache';
import { deriveSeasonMatchesPage } from '$lib/public-data/derive';

export const load: PageLoad = async ({ parent, params, url }) => {
  await parent();
  const pageData = deriveSeasonMatchesPage(
    await getPublicSnapshot({ check: false }),
    params.season_id,
    { eventId: url.searchParams.get('event') }
  );

  if (!pageData) throw error(404, 'Season not found');
  return pageData;
};
