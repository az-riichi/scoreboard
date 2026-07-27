import type { PageLoad } from './$types';
import { getPublicSnapshot } from '$lib/public-data/cache';
import { deriveSeasonsPage } from '$lib/public-data/derive';

export const load: PageLoad = async ({ parent }) => {
  await parent();
  return deriveSeasonsPage(await getPublicSnapshot({ check: false }));
};
