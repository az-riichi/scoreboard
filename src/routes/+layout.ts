import type { LayoutLoad } from './$types';
import { getPublicSnapshot } from '$lib/public-data/cache';

// Render the initial document as a lightweight app shell. Public scoreboard
// data is conditionally synchronized once here and then reused from memory by
// every child route.
export const ssr = false;

export const load: LayoutLoad = async ({ data, depends }) => {
  depends('app:public-data');
  const snapshot = await getPublicSnapshot();
  const activeSeasonId =
    snapshot.seasons.find((season) => season.is_active === true && season.is_casual !== true)?.id ??
    null;

  return { ...data, activeSeasonId };
};
