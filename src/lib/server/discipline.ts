import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { DisciplineActionRow } from '$lib/discipline';

const DISCIPLINE_PAGE_SIZE = 500;
const MATCH_ID_BATCH_SIZE = 100;
const DISCIPLINE_ACTION_COLUMNS =
  'id, player_id, action_type, reason, match_id, issued_at, effective_on, expires_on, source, trigger_action_id, revoked_at, revocation_reason';

export type DisciplineActionLoadResult = {
  data: DisciplineActionRow[];
  error: PostgrestError | null;
};

export type DisciplineLinkedMatch = {
  id: string;
  played_at: string;
  table_label: string | null;
  status: string;
};

/** Loads a player's complete private ledger despite PostgREST response limits. */
export async function loadPlayerDisciplineActions(
  supabase: SupabaseClient,
  playerId: string
): Promise<DisciplineActionLoadResult> {
  const actions: DisciplineActionRow[] = [];

  let offset = 0;
  for (;;) {
    const response = await supabase
      .from('discipline_actions')
      .select(DISCIPLINE_ACTION_COLUMNS, { count: 'exact' })
      .eq('player_id', playerId)
      .order('issued_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + DISCIPLINE_PAGE_SIZE - 1);

    if (response.error) return { data: [], error: response.error };

    const page = (response.data ?? []) as DisciplineActionRow[];
    actions.push(...page);
    offset += page.length;
    if (page.length === 0 || (response.count != null && offset >= response.count)) break;
    if (response.count == null && page.length < DISCIPLINE_PAGE_SIZE) break;
  }

  return { data: actions, error: null };
}

/** Loads optional linked-match labels in bounded URL-sized batches. */
export async function loadDisciplineLinkedMatches(
  supabase: SupabaseClient,
  matchIds: readonly string[]
): Promise<{ data: DisciplineLinkedMatch[]; error: PostgrestError | null }> {
  const uniqueIds = [...new Set(matchIds)];
  const matches: DisciplineLinkedMatch[] = [];

  for (let start = 0; start < uniqueIds.length; start += MATCH_ID_BATCH_SIZE) {
    const response = await supabase
      .from('matches')
      .select('id, played_at, table_label, status')
      .in('id', uniqueIds.slice(start, start + MATCH_ID_BATCH_SIZE));

    if (response.error) return { data: [], error: response.error };
    matches.push(...((response.data ?? []) as DisciplineLinkedMatch[]));
  }

  return { data: matches, error: null };
}
