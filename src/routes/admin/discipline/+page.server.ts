import { error as kitError, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { summarizeDiscipline, type DisciplineActionType } from '$lib/discipline';
import { fmtDateTimeArizona } from '$lib/arizona-time';
import { composeSeasonNameParts } from '$lib/player-name';
import { requireAdmin } from '$lib/server/admin';
import { loadDisciplineLinkedMatches, loadPlayerDisciplineActions } from '$lib/server/discipline';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTION_TYPES = new Set<DisciplineActionType>(['strike', 'suspension', 'ban']);
const MAX_REASON_LENGTH = 2_000;

function asText(value: unknown) {
  return String(value ?? '').trim();
}

function asUuid(value: unknown) {
  const text = asText(value);
  return UUID_RE.test(text) ? text : null;
}

function playerLabel(player: Record<string, unknown>) {
  const names = composeSeasonNameParts(player);
  return names.secondary ? `${names.primary} (${names.secondary})` : names.primary;
}

function matchLabel(match: Record<string, unknown>) {
  const table = asText(match.table_label) || asText(match.id).slice(0, 8);
  const status = asText(match.status);
  const when = fmtDateTimeArizona(asText(match.played_at));
  return `${table} · ${when}${status && status !== 'final' ? ` · ${status}` : ''}`;
}

export const load: PageServerLoad = async ({ locals, url, setHeaders }) => {
  await requireAdmin(locals);
  setHeaders({ 'cache-control': 'private, no-store' });

  const playersRes = await locals.supabase
    .from('players')
    .select(
      'id, display_name, real_first_name, real_last_name, show_display_name, show_real_first_name, show_real_last_name'
    )
    .order('created_at', { ascending: true });

  if (playersRes.error) throw kitError(500, 'Could not load players.');

  const players = (playersRes.data ?? [])
    .map((player) => ({ id: String(player.id), label: playerLabel(player) }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));

  const requestedPlayerId = asUuid(url.searchParams.get('player'));
  const selectedPlayerId =
    (requestedPlayerId && players.some((player) => player.id === requestedPlayerId)
      ? requestedPlayerId
      : players[0]?.id) ?? null;
  const selectedPlayer = players.find((player) => player.id === selectedPlayerId) ?? null;

  const recentMatchesPromise = locals.supabase
    .from('matches')
    .select('id, played_at, table_label, status')
    .neq('status', 'void')
    .order('played_at', { ascending: false })
    .limit(250);

  if (!selectedPlayerId) {
    const recentMatchesRes = await recentMatchesPromise;
    return {
      players,
      selectedPlayerId: null,
      selectedPlayer: null,
      summary: summarizeDiscipline([]),
      actions: [],
      matches: recentMatchesRes.error
        ? []
        : (recentMatchesRes.data ?? []).map((match) => ({ id: String(match.id), label: matchLabel(match) }))
    };
  }

  const [actionsRes, recentMatchesRes] = await Promise.all([
    loadPlayerDisciplineActions(locals.supabase, selectedPlayerId),
    recentMatchesPromise
  ]);

  if (actionsRes.error) throw kitError(500, 'Could not load discipline history.');
  if (recentMatchesRes.error) throw kitError(500, 'Could not load matches.');

  const actions = actionsRes.data;
  const matchIds = [...new Set(actions.map((action) => asUuid(action.match_id)).filter((id): id is string => !!id))];
  const linkedMatchesRes = await loadDisciplineLinkedMatches(locals.supabase, matchIds);

  if (linkedMatchesRes.error) throw kitError(500, 'Could not load linked matches.');

  const allMatches = [...(recentMatchesRes.data ?? []), ...linkedMatchesRes.data];
  const matchById = new Map(allMatches.map((match) => [String(match.id), match] as const));
  const matches = [...new Map(
    (recentMatchesRes.data ?? []).map((match) => [
      String(match.id),
      { id: String(match.id), label: matchLabel(match) }
    ])
  ).values()];

  return {
    players,
    selectedPlayerId,
    selectedPlayer,
    summary: summarizeDiscipline(actions),
    actions: actions.map((action) => {
      const linkedMatch = action.match_id ? matchById.get(String(action.match_id)) : null;
      return {
        ...action,
        match_label: linkedMatch ? matchLabel(linkedMatch) : null
      };
    }),
    matches
  };
};

export const actions: Actions = {
  issue: async ({ request, locals }) => {
    await requireAdmin(locals);
    const form = await request.formData();
    const playerId = asUuid(form.get('player_id'));
    const actionTypeText = asText(form.get('action_type')).toLowerCase();
    const reason = asText(form.get('reason'));
    const matchIdText = asText(form.get('match_id'));
    const matchId = matchIdText ? asUuid(matchIdText) : null;

    if (!playerId) return fail(400, { ok: false, message: 'Choose a valid player.' });
    if (!ACTION_TYPES.has(actionTypeText as DisciplineActionType)) {
      return fail(400, { ok: false, message: 'Choose Strike, Suspension, or Ban.', player_id: playerId });
    }
    if (!reason) {
      return fail(400, { ok: false, message: 'Reason is required.', player_id: playerId });
    }
    if (reason.length > MAX_REASON_LENGTH) {
      return fail(400, {
        ok: false,
        message: `Reason must be ${MAX_REASON_LENGTH.toLocaleString()} characters or fewer.`,
        player_id: playerId
      });
    }
    if (matchIdText && !matchId) {
      return fail(400, { ok: false, message: 'Choose a valid match.', player_id: playerId });
    }

    const issueRes = await locals.supabase.rpc('issue_discipline_action', {
      p_player_id: playerId,
      p_action_type: actionTypeText,
      p_reason: reason,
      p_match_id: matchId
    });

    if (issueRes.error) {
      return fail(400, { ok: false, message: issueRes.error.message, player_id: playerId });
    }

    return {
      ok: true,
      message: 'Discipline action issued. Any required automatic escalation was also applied.',
      player_id: playerId
    };
  },

  revoke: async ({ request, locals }) => {
    await requireAdmin(locals);
    const form = await request.formData();
    const playerId = asUuid(form.get('player_id'));
    const actionId = asUuid(form.get('action_id'));
    const reason = asText(form.get('revocation_reason'));

    if (!actionId) {
      return fail(400, { ok: false, message: 'Invalid discipline action.', player_id: playerId });
    }
    if (!reason) {
      return fail(400, { ok: false, message: 'Revocation reason is required.', player_id: playerId });
    }
    if (reason.length > MAX_REASON_LENGTH) {
      return fail(400, {
        ok: false,
        message: `Revocation reason must be ${MAX_REASON_LENGTH.toLocaleString()} characters or fewer.`,
        player_id: playerId
      });
    }

    const revokeRes = await locals.supabase.rpc('revoke_discipline_action', {
      p_action_id: actionId,
      p_reason: reason
    });

    if (revokeRes.error) {
      return fail(400, { ok: false, message: revokeRes.error.message, player_id: playerId });
    }

    return { ok: true, message: 'Discipline action revoked.', player_id: playerId };
  }
};
