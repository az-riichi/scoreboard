import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import { derivePublicPage } from '$lib/public-data/cache';
import { deriveMatchPage } from '$lib/public-data/derive';

export const load: PageLoad = async ({ parent, params }) => {
  await parent();
  const pageData = await derivePublicPage((snapshot) => deriveMatchPage(snapshot, params.match_id));

  if (!pageData) throw error(404, 'Match not found');
  return pageData;
};
