import type { LayoutLoad } from './$types';
import { getPublicSnapshot } from '$lib/public-data/cache';
import { findActiveSeasonId } from '$lib/public-data/derive';

// Render the initial document as a lightweight app shell. Public scoreboard data
// comes from the copy this browser kept, or is downloaded on a first visit, and
// is reused from memory by every child route. Live updates replace it before
// invalidating loads. This layout has no server load on purpose: one would make
// every first page view wait on a server function before anything could render.
export const ssr = false;

export const load: LayoutLoad = async ({ depends }) => {
  depends('app:public-data');
  const snapshot = await getPublicSnapshot({ check: false });

  return {
    activeSeasonId: findActiveSeasonId(snapshot),
    publicDataRevision: String(snapshot.revision.revision)
  };
};
