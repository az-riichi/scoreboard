import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ parent }) => {
  const { activeSeasonId } = await parent();
  throw redirect(303, activeSeasonId ? `/season/${activeSeasonId}` : '/seasons');
};
