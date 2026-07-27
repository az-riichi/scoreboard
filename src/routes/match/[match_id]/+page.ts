import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import { getPublicSnapshot } from '$lib/public-data/cache';
import { deriveMatchPage } from '$lib/public-data/derive';

export const load: PageLoad = async ({ parent, params }) => {
  await parent();
  const pageData = deriveMatchPage(
    await getPublicSnapshot({ check: false }),
    params.match_id
  );

  if (!pageData) throw error(404, 'Match not found');
  return pageData;
};
