import { composePlayerDisplayName } from '../player-name';
import type {
  DerivedFinalResult,
  PublicCasualEvent,
  PublicFinalMatch,
  PublicRuleset,
  RawMatchResult,
  RedactedPublicPlayer,
  Seat
} from './types';

export const SEAT_PRIORITY: Readonly<Record<Seat, number>> = {
  E: 1,
  S: 2,
  W: 3,
  N: 4
};

function finiteNumber(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be a finite number`);
  return number;
}

function assertCompleteMatch(rows: readonly RawMatchResult[], matchId: string) {
  if (rows.length !== 4) {
    throw new Error(`Final match ${matchId} must have exactly four raw results`);
  }

  if (new Set(rows.map((row) => row.seat)).size !== 4) {
    throw new Error(`Final match ${matchId} must have four distinct seats`);
  }

  if (new Set(rows.map((row) => row.player_id)).size !== 4) {
    throw new Error(`Final match ${matchId} must have four distinct players`);
  }
}

function valuesByPlace(ruleset: PublicRuleset, prefix: 'uma' | 'oka'): readonly number[] {
  return [
    finiteNumber(ruleset[`${prefix}_1`], `${prefix}_1`),
    finiteNumber(ruleset[`${prefix}_2`], `${prefix}_2`),
    finiteNumber(ruleset[`${prefix}_3`], `${prefix}_3`),
    finiteNumber(ruleset[`${prefix}_4`], `${prefix}_4`)
  ];
}

/**
 * Reproduces recompute_match_derived using only immutable source rows.
 * Placement uses seat order as the deterministic tie-break; UMA is averaged
 * over every rank occupied by tied raw scores.
 */
export function scoreMatchResults(
  match: PublicFinalMatch,
  rawRows: readonly RawMatchResult[],
  ruleset: PublicRuleset,
  playersById: ReadonlyMap<string, RedactedPublicPlayer>,
  eventsById: ReadonlyMap<string, PublicCasualEvent> = new Map()
): DerivedFinalResult[] {
  assertCompleteMatch(rawRows, match.id);

  const divisor = finiteNumber(ruleset.point_divisor, 'point_divisor');
  if (divisor === 0) throw new Error(`Ruleset ${ruleset.id} has a zero point divisor`);

  const returnPoints = finiteNumber(ruleset.return_points, 'return_points');
  const uma = valuesByPlace(ruleset, 'uma');
  const oka = valuesByPlace(ruleset, 'oka');
  const ordered = [...rawRows].sort((left, right) => {
    const rawDifference =
      finiteNumber(right.raw_points, 'raw_points') - finiteNumber(left.raw_points, 'raw_points');
    if (rawDifference !== 0) return rawDifference;
    return SEAT_PRIORITY[left.seat] - SEAT_PRIORITY[right.seat];
  });

  const event = match.casual_event_id ? eventsById.get(match.casual_event_id) : undefined;

  return ordered.map((row, index) => {
    const rawPoints = finiteNumber(row.raw_points, 'raw_points');
    const placement = index + 1;
    const tieStart = ordered.findIndex(
      (candidate) => finiteNumber(candidate.raw_points, 'raw_points') === rawPoints
    );
    let tieEnd = tieStart;
    while (
      tieEnd + 1 < ordered.length &&
      finiteNumber(ordered[tieEnd + 1].raw_points, 'raw_points') === rawPoints
    ) {
      tieEnd += 1;
    }

    const tiedUma = uma.slice(tieStart, tieEnd + 1);
    const splitUma = tiedUma.reduce((total, value) => total + value, 0) / tiedUma.length;
    const player = playersById.get(row.player_id);

    return {
      match_id: match.id,
      season_id: match.season_id,
      ruleset_id: match.ruleset_id,
      game_number: match.game_number,
      table_mode: match.table_mode,
      extra_sticks: match.extra_sticks,
      played_at: match.played_at,
      table_label: match.table_label,
      seat: row.seat,
      player_id: row.player_id,
      display_name: player ? composePlayerDisplayName(player) : 'Unnamed player',
      raw_points: rawPoints,
      club_points: (rawPoints - returnPoints) / divisor + splitUma + oka[index],
      placement,
      tobi: rawPoints < 0,
      casual_event_id: match.casual_event_id,
      casual_event_name: event?.name ?? null
    };
  });
}
