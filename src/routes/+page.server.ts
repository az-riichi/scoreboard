import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
  const { activeSeasonId } = await parent();
  const activeId = activeSeasonId ?? null;
  throw redirect(303, activeId ? `/season/${activeId}` : '/seasons');
};
