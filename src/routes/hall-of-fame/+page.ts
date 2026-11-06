import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import { getPublicSnapshot } from '$lib/public-data/cache';
import { deriveHallOfFame } from '$lib/public-data/hall-of-fame';

export const load: PageLoad = async ({ parent, url }) => {
  await parent();
  const pageData = deriveHallOfFame(await getPublicSnapshot({ check: false }), {
    seasonId: url.searchParams.get('season')
  });

  if (!pageData) throw error(404, 'Season not found');
  return pageData;
};
