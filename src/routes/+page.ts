import { redirect } from '@sveltejs/kit';
import { goto } from '$app/navigation';
import type { PageLoad } from './$types';
import { getPublicSnapshot } from '$lib/public-data/cache';
import { findActiveSeasonId } from '$lib/public-data/derive';

function landingPath(activeSeasonId: string | null) {
  return activeSeasonId ? `/season/${activeSeasonId}` : '/seasons';
}

export const load: PageLoad = async ({ parent }) => {
  const landing = landingPath((await parent()).activeSeasonId);

  // The copy this browser kept can predate a new season. Move the visitor on if
  // the check finds one, unless they have already gone somewhere else.
  void getPublicSnapshot()
    .then((snapshot) => {
      const current = landingPath(findActiveSeasonId(snapshot));
      if (current !== landing && location.pathname === landing) {
        void goto(current, { replaceState: true });
      }
    })
    .catch(() => {});

  throw redirect(303, landing);
};
