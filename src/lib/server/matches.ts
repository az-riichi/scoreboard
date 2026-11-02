import type { SupabaseClient } from '@supabase/supabase-js';

type NextGameNumberResult =
  | { gameNumber: number; error: null }
  | { gameNumber: null; error: string };

/** Fetch only the highest number; the database still enforces concurrent uniqueness. */
export async function loadNextGameNumber(
  supabase: SupabaseClient,
  seasonId: string,
  tableMode: 'A' | 'M',
  dayBounds: { dayStart: string; dayEnd: string },
  excludeMatchId?: string
): Promise<NextGameNumberResult> {
  let query = supabase
    .from('matches')
    .select('game_number')
    .eq('season_id', seasonId)
    .gte('played_at', dayBounds.dayStart)
    .lt('played_at', dayBounds.dayEnd)
    .eq('table_mode', tableMode)
    .order('game_number', { ascending: false, nullsFirst: false })
    .limit(1);

  if (excludeMatchId) query = query.neq('id', excludeMatchId);

  const result = await query;
  if (result.error) return { gameNumber: null, error: result.error.message };

  const gameNumber = Number(result.data?.[0]?.game_number ?? 0) + 1;
  if (!Number.isSafeInteger(gameNumber) || gameNumber < 1 || gameNumber > 2_147_483_647) {
    return { gameNumber: null, error: 'Could not allocate a valid game number.' };
  }

  return { gameNumber, error: null };
}
