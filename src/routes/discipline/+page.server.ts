import { error as kitError, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { summarizeDiscipline } from '$lib/discipline';
import { fmtDateTimeArizona } from '$lib/arizona-time';
import { composeSeasonNameParts } from '$lib/player-name';
import { loadDisciplineLinkedMatches, loadPlayerDisciplineActions } from '$lib/server/discipline';

function asText(value: unknown) {
  return String(value ?? '').trim();
}

function matchLabel(match: Record<string, unknown>) {
  const table = asText(match.table_label) || asText(match.id).slice(0, 8);
  return `${table} · ${fmtDateTimeArizona(asText(match.played_at))}`;
}

export const load: PageServerLoad = async ({ locals, setHeaders }) => {
  if (!locals.user || !locals.userId) throw redirect(303, '/login?next=%2Fdiscipline');

  setHeaders({
    'cache-control': 'private, no-store'
  });

  const accountRes = await locals.supabase
    .from('player_accounts')
    .select('player_id')
    .eq('auth_user_id', locals.userId)
    .maybeSingle();

  if (accountRes.error) throw kitError(500, 'Could not load your player account.');
  if (!accountRes.data) {
    return {
      player: null,
      summary: summarizeDiscipline([]),
      actions: []
    };
  }

  const playerId = String(accountRes.data.player_id);
  const [playerRes, actionsRes] = await Promise.all([
    locals.supabase
      .from('players')
      .select(
        'id, display_name, real_first_name, real_last_name, show_display_name, show_real_first_name, show_real_last_name'
      )
      .eq('id', playerId)
      .maybeSingle(),
    loadPlayerDisciplineActions(locals.supabase, playerId)
  ]);

  if (playerRes.error || !playerRes.data) throw kitError(500, 'Could not load your player profile.');
  if (actionsRes.error) throw kitError(500, 'Could not load your discipline history.');

  const names = composeSeasonNameParts(playerRes.data);
  const player = {
    id: playerId,
    label: names.secondary ? `${names.primary} (${names.secondary})` : names.primary
  };
  const actions = actionsRes.data;
  const matchIds = [...new Set(actions.map((action) => asText(action.match_id)).filter(Boolean))];
  const matchesRes = await loadDisciplineLinkedMatches(locals.supabase, matchIds);

  if (matchesRes.error) throw kitError(500, 'Could not load linked matches.');

  const matchById = new Map(matchesRes.data.map((match) => [String(match.id), match] as const));

  return {
    player,
    summary: summarizeDiscipline(actions),
    actions: actions.map((action) => {
      const linkedMatch = action.match_id ? matchById.get(String(action.match_id)) : null;
      return {
        ...action,
        match_label: linkedMatch ? matchLabel(linkedMatch) : null,
        match_is_public: linkedMatch != null
      };
    })
  };
};
