export const DISCIPLINE_TIME_ZONE = 'America/Phoenix';

export type DisciplineActionType = 'strike' | 'suspension' | 'ban';
export type DisciplineStatus = 'eligible' | 'suspended' | 'banned';

/**
 * Columns used by the discipline helpers. Additional database columns (reason,
 * match_id, audit actors, and so on) remain available on the returned row.
 */
export interface DisciplineActionRow {
  id: string;
  player_id: string;
  action_type: DisciplineActionType;
  issued_at: string;
  effective_on: string;
  expires_on: string | null;
  revoked_at: string | null;
  [column: string]: unknown;
}

export interface DisciplineSummary {
  status: DisciplineStatus;
  activeStrikeCount: number;
  /** All suspensions that have not been revoked, including expired ones. */
  suspensionCount: number;
  /** The ban or suspension currently controlling competitive eligibility. */
  currentAction: DisciplineActionRow | null;
}

export type DisciplineDateInput = string | Date;

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const azDatePartsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: DISCIPLINE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

function parseIsoDate(value: string) {
  const match = ISO_DATE_RE.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() + 1 !== month ||
    check.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

/** Converts a date/timestamp to its Arizona calendar date (YYYY-MM-DD). */
export function toArizonaDate(value: DisciplineDateInput): string {
  if (typeof value === 'string') {
    const text = value.trim();
    if (parseIsoDate(text)) return text;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new RangeError('Invalid discipline date');

  const parts = azDatePartsFormatter.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) throw new RangeError('Could not resolve Arizona calendar date');
  return `${year}-${month}-${day}`;
}

/** Adds calendar days without involving the host machine's local timezone. */
export function addDisciplineCalendarDays(isoDate: string, days: number): string {
  const parsed = parseIsoDate(isoDate);
  if (!parsed || !Number.isInteger(days)) throw new RangeError('Invalid discipline calendar date');

  const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/** Returns the inclusive policy expiration date for a newly issued action. */
export function disciplineExpiresOn(actionType: DisciplineActionType, effectiveOn: string): string | null {
  if (!parseIsoDate(effectiveOn)) throw new RangeError('Invalid discipline effective date');
  if (actionType === 'strike') return addDisciplineCalendarDays(effectiveOn, 29);
  if (actionType === 'suspension') return addDisciplineCalendarDays(effectiveOn, 13);
  return null;
}

function actionEffectiveOn(action: DisciplineActionRow) {
  if (!parseIsoDate(action.effective_on)) throw new RangeError('Invalid discipline effective_on date');
  return action.effective_on;
}

function actionExpiresOn(action: DisciplineActionRow) {
  if (action.action_type === 'ban') return null;
  if (action.expires_on != null) {
    if (!parseIsoDate(action.expires_on)) throw new RangeError('Invalid discipline expires_on date');
    return action.expires_on;
  }
  return disciplineExpiresOn(action.action_type, actionEffectiveOn(action));
}

/** Revocation removes an action from both history counts and eligibility calculations. */
export function isDisciplineActionEffective(
  action: DisciplineActionRow,
  reference: DisciplineDateInput = new Date()
): boolean {
  if (action.revoked_at != null) return false;

  const onDate = toArizonaDate(reference);
  const startsOn = actionEffectiveOn(action);
  if (onDate < startsOn) return false;

  const expiresOn = actionExpiresOn(action);
  return expiresOn == null || onDate <= expiresOn;
}

function laterIssuedAction(a: DisciplineActionRow, b: DisciplineActionRow) {
  const effectiveCompare = a.effective_on.localeCompare(b.effective_on);
  if (effectiveCompare !== 0) return effectiveCompare > 0 ? a : b;

  const issuedCompare = a.issued_at.localeCompare(b.issued_at);
  if (issuedCompare !== 0) return issuedCompare > 0 ? a : b;
  return a.id.localeCompare(b.id) >= 0 ? a : b;
}

function controllingSuspension(a: DisciplineActionRow, b: DisciplineActionRow) {
  const aExpires = actionExpiresOn(a) ?? '';
  const bExpires = actionExpiresOn(b) ?? '';
  if (aExpires !== bExpires) return aExpires > bExpires ? a : b;
  return laterIssuedAction(a, b);
}

export function summarizeDiscipline(
  actions: readonly DisciplineActionRow[],
  reference: DisciplineDateInput = new Date()
): DisciplineSummary {
  let activeStrikeCount = 0;
  let suspensionCount = 0;
  let currentBan: DisciplineActionRow | null = null;
  let currentSuspension: DisciplineActionRow | null = null;

  for (const action of actions) {
    if (action.revoked_at != null) continue;

    if (action.action_type === 'suspension') suspensionCount += 1;
    if (!isDisciplineActionEffective(action, reference)) continue;

    if (action.action_type === 'strike') {
      activeStrikeCount += 1;
    } else if (action.action_type === 'ban') {
      currentBan = currentBan ? laterIssuedAction(currentBan, action) : action;
    } else if (action.action_type === 'suspension') {
      currentSuspension = currentSuspension
        ? controllingSuspension(currentSuspension, action)
        : action;
    }
  }

  if (currentBan) {
    return {
      status: 'banned',
      activeStrikeCount,
      suspensionCount,
      currentAction: currentBan
    };
  }

  if (currentSuspension) {
    return {
      status: 'suspended',
      activeStrikeCount,
      suspensionCount,
      currentAction: currentSuspension
    };
  }

  return {
    status: 'eligible',
    activeStrikeCount,
    suspensionCount,
    currentAction: null
  };
}

export function isEligibleForCompetitivePlay(
  actions: readonly DisciplineActionRow[],
  reference: DisciplineDateInput = new Date()
) {
  return summarizeDiscipline(actions, reference).status === 'eligible';
}

/** Builds summaries for admin/match routes that load actions for many players. */
export function summarizeDisciplineByPlayer(
  actions: readonly DisciplineActionRow[],
  reference: DisciplineDateInput = new Date()
) {
  const actionsByPlayer = new Map<string, DisciplineActionRow[]>();
  for (const action of actions) {
    const rows = actionsByPlayer.get(action.player_id);
    if (rows) rows.push(action);
    else actionsByPlayer.set(action.player_id, [action]);
  }

  return new Map(
    [...actionsByPlayer].map(([playerId, playerActions]) => [
      playerId,
      summarizeDiscipline(playerActions, reference)
    ])
  );
}
