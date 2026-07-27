import { composePlayerDisplayName, composeSeasonNameParts } from '../player-name';
import {
  classifyPlayerProfileMedia,
  renderPlayerProfileMarkdown
} from '../player-profile-content';
import { ratingGamesAdjustment } from '../rating';
import { scoreMatchResults } from './scoring';
import type {
  DerivedFinalResult,
  LifetimeRatings,
  LifetimeRatingState,
  MatchPageData,
  PlayerMatchHistoryRow,
  PlayerNameParts,
  PlayerPageData,
  PlayerPlacementHistoryRow,
  PlayerPointHistoryRow,
  PlayerStats,
  PublicAdjustment,
  PublicCasualEvent,
  PublicDataSnapshot,
  PublicFinalMatch,
  PublicSeason,
  RatingHistoryRow,
  RawMatchExtreme,
  RecentMatchSummary,
  RedactedPublicPlayer,
  SeasonPageData,
  SeasonsPageData,
  StandingsRow
} from './types';

const FALLBACK_RATING_START_DATE = '2026-01-01';

export type PublicDataModel = {
  snapshot: PublicDataSnapshot;
  ratingStartDate: string;
  seasonsById: ReadonlyMap<string, PublicSeason>;
  eventsById: ReadonlyMap<string, PublicCasualEvent>;
  playersById: ReadonlyMap<string, RedactedPublicPlayer>;
  matchesById: ReadonlyMap<string, PublicFinalMatch>;
  results: DerivedFinalResult[];
  resultsByMatchId: ReadonlyMap<string, DerivedFinalResult[]>;
  lifetimeRatings: LifetimeRatings;
};

export type PublicDataSource = PublicDataSnapshot | PublicDataModel;

export type SeasonPageOptions = {
  eventId?: string | null;
};

export type PlayerPageOptions = {
  seasonId?: string | null;
  eventId?: string | null;
};

const modelCache = new WeakMap<PublicDataSnapshot, PublicDataModel>();

function asNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function compareDateText(left: string | null, right: string | null): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;

  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return left.localeCompare(right);
}

function compareDateTextDescendingNullsLast(
  left: string | null,
  right: string | null
): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return -compareDateText(left, right);
}

function compareMatchesAscending(left: PublicFinalMatch, right: PublicFinalMatch): number {
  return compareDateText(left.played_at, right.played_at) || left.id.localeCompare(right.id);
}

function compareResultsAscending(left: DerivedFinalResult, right: DerivedFinalResult): number {
  return compareDateText(left.played_at, right.played_at) || left.match_id.localeCompare(right.match_id);
}

function seasonStartDescending(left: PublicSeason, right: PublicSeason): number {
  if (left.is_casual !== right.is_casual) return left.is_casual ? -1 : 1;
  return (
    compareDateTextDescendingNullsLast(left.start_date, right.start_date) ||
    left.name.localeCompare(right.name) ||
    left.id.localeCompare(right.id)
  );
}

function matchLabel(match: PublicFinalMatch): string {
  const explicit = clean(match.table_label);
  if (explicit) return explicit;
  if (match.table_mode && match.game_number) return `${match.table_mode}-${match.game_number}`;
  return match.id;
}

function playerNameParts(
  playersById: ReadonlyMap<string, RedactedPublicPlayer>,
  playerId: string
): PlayerNameParts {
  const parts = composeSeasonNameParts(playersById.get(playerId) ?? {});
  return {
    player_name_primary: parts.primary,
    player_name_secondary: parts.secondary
  };
}

function getRatingStartDate(seasons: readonly PublicSeason[]): string {
  const configured = seasons
    .filter(
      (season) =>
        !season.is_casual &&
        season.name.trim().toLocaleLowerCase().startsWith('spring 2026') &&
        clean(season.start_date).length > 0
    )
    .sort((left, right) => compareDateText(left.start_date, right.start_date))[0]?.start_date;

  return clean(configured) || FALLBACK_RATING_START_DATE;
}

function isRatingSeason(season: PublicSeason | null | undefined, ratingStartDate: string): boolean {
  return !!(
    season &&
    !season.is_casual &&
    clean(season.start_date) &&
    clean(season.start_date) >= ratingStartDate
  );
}

function calculateLifetimeRatings(
  matches: readonly PublicFinalMatch[],
  resultsByMatchId: ReadonlyMap<string, DerivedFinalResult[]>,
  seasonsById: ReadonlyMap<string, PublicSeason>,
  playersById: ReadonlyMap<string, RedactedPublicPlayer>,
  ratingStartDate: string
): LifetimeRatings {
  type MutableState = {
    rate: number;
    games_played: number;
    updated_at: string | null;
  };

  const mutableState = new Map<string, MutableState>();
  const history: RatingHistoryRow[] = [];
  const eligibleMatches = matches
    .filter((match) => {
      const season = seasonsById.get(match.season_id);
      return (
        match.status === 'final' &&
        match.include_in_lifetime_rating &&
        !!season &&
        !season.is_casual &&
        clean(season.start_date) >= ratingStartDate
      );
    })
    .sort(compareMatchesAscending);

  for (const match of eligibleMatches) {
    const results = resultsByMatchId.get(match.id) ?? [];
    if (results.length !== 4) continue;

    for (const result of results) {
      if (!mutableState.has(result.player_id)) {
        mutableState.set(result.player_id, {
          rate: 1500,
          games_played: 0,
          updated_at: null
        });
      }
    }

    const averageRate =
      results.reduce(
        (total, result) => total + (mutableState.get(result.player_id)?.rate ?? 1500),
        0
      ) / results.length;

    // Every delta uses the pre-match state, matching the database transaction.
    const events = results.map((result): RatingHistoryRow => {
      const state = mutableState.get(result.player_id)!;
      const basePoints = [30, 10, -10, -30][result.placement - 1] ?? 0;
      const delta =
        ratingGamesAdjustment(state.games_played) *
        (basePoints + (averageRate - state.rate) / 40);
      const name = playerNameParts(playersById, result.player_id);

      return {
        is_lifetime: true,
        season_id: null,
        player_id: result.player_id,
        display_name: result.display_name,
        played_at: match.played_at,
        match_id: match.id,
        placement: result.placement,
        old_rate: state.rate,
        delta,
        new_rate: state.rate + delta,
        games_played_before: state.games_played,
        match_label: matchLabel(match),
        ...name
      };
    });

    for (const event of events) {
      mutableState.set(event.player_id, {
        rate: event.new_rate,
        games_played: event.games_played_before + 1,
        updated_at: match.played_at
      });
      history.push(event);
    }
  }

  const ranked = Array.from(mutableState.entries())
    .map(([player_id, current]) => ({ player_id, ...current }))
    .sort((left, right) => right.rate - left.rate || left.player_id.localeCompare(right.player_id));

  let rank = 0;
  let previousRate: number | null = null;
  const state: LifetimeRatingState[] = ranked.map((row) => {
    if (previousRate == null || row.rate !== previousRate) {
      rank += 1;
      previousRate = row.rate;
    }
    return {
      is_lifetime: true,
      season_id: null,
      player_id: row.player_id,
      display_name: composePlayerDisplayName(playersById.get(row.player_id) ?? {}),
      rate: row.rate,
      games_played: row.games_played,
      updated_at: row.updated_at,
      rank
    };
  });

  const stateByPlayerId = new Map(state.map((row) => [row.player_id, row]));
  const historyByMatchId = new Map<string, RatingHistoryRow[]>();
  const historyByPlayerId = new Map<string, RatingHistoryRow[]>();
  for (const row of history) {
    const matchRows = historyByMatchId.get(row.match_id) ?? [];
    matchRows.push(row);
    historyByMatchId.set(row.match_id, matchRows);

    const playerRows = historyByPlayerId.get(row.player_id) ?? [];
    playerRows.push(row);
    historyByPlayerId.set(row.player_id, playerRows);
  }

  return {
    history,
    state,
    stateByPlayerId,
    historyByMatchId,
    historyByPlayerId
  };
}

function buildModel(snapshot: PublicDataSnapshot): PublicDataModel {
  const seasonsById = new Map(snapshot.seasons.map((season) => [season.id, season]));
  const eventsById = new Map(snapshot.casual_events.map((event) => [event.id, event]));
  const playersById = new Map(snapshot.players.map((player) => [player.id, player]));
  const rulesetsById = new Map(snapshot.rulesets.map((ruleset) => [ruleset.id, ruleset]));
  const matches = snapshot.matches.filter((match) => match.status === 'final');
  const matchesById = new Map(matches.map((match) => [match.id, match]));
  const rawByMatchId = new Map<string, typeof snapshot.match_results>();

  for (const result of snapshot.match_results) {
    if (!matchesById.has(result.match_id)) continue;
    const rows = rawByMatchId.get(result.match_id) ?? [];
    rows.push(result);
    rawByMatchId.set(result.match_id, rows);
  }

  const resultsByMatchId = new Map<string, DerivedFinalResult[]>();
  const results: DerivedFinalResult[] = [];
  for (const match of matches) {
    const ruleset = rulesetsById.get(match.ruleset_id);
    if (!ruleset) throw new Error(`Ruleset ${match.ruleset_id} for final match ${match.id} is missing`);
    const scored = scoreMatchResults(
      match,
      rawByMatchId.get(match.id) ?? [],
      ruleset,
      playersById,
      eventsById
    );
    resultsByMatchId.set(match.id, scored);
    results.push(...scored);
  }

  const ratingStartDate = getRatingStartDate(snapshot.seasons);
  const lifetimeRatings = calculateLifetimeRatings(
    matches,
    resultsByMatchId,
    seasonsById,
    playersById,
    ratingStartDate
  );

  return {
    snapshot,
    ratingStartDate,
    seasonsById,
    eventsById,
    playersById,
    matchesById,
    results,
    resultsByMatchId,
    lifetimeRatings
  };
}

function isModel(source: PublicDataSource): source is PublicDataModel {
  return 'snapshot' in source;
}

function modelFor(source: PublicDataSource): PublicDataModel {
  if (isModel(source)) return source;
  const cached = modelCache.get(source);
  if (cached) return cached;
  const model = buildModel(source);
  modelCache.set(source, model);
  return model;
}

/**
 * Builds and memoizes all snapshot-wide work. Page-specific derivations reuse
 * this object, so scoring and rating history are calculated once per refresh.
 */
export function derivePublicData(snapshot: PublicDataSnapshot): PublicDataModel {
  return modelFor(snapshot);
}

export function deriveFinalResults(source: PublicDataSource): DerivedFinalResult[] {
  return [...modelFor(source).results];
}

export function deriveLifetimeRatings(source: PublicDataSource): LifetimeRatings {
  return modelFor(source).lifetimeRatings;
}

function resultsForScope(
  model: PublicDataModel,
  seasonId: string,
  eventId: string | null
): DerivedFinalResult[] {
  return model.results.filter(
    (result) =>
      result.season_id === seasonId &&
      (eventId == null || result.casual_event_id === eventId)
  );
}

function adjustmentPointsByPlayer(
  model: PublicDataModel,
  seasonId: string,
  eventId: string | null
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const adjustment of model.snapshot.adjustments) {
    if (adjustment.season_id !== seasonId) continue;

    if (eventId == null) {
      if (adjustment.match_id != null) {
        const match = model.matchesById.get(adjustment.match_id);
        if (!match || match.season_id !== seasonId) continue;
      }
    } else {
      if (adjustment.match_id == null) continue;
      const match = model.matchesById.get(adjustment.match_id);
      if (
        !match ||
        match.season_id !== seasonId ||
        match.casual_event_id !== eventId
      ) {
        continue;
      }
    }

    totals.set(
      adjustment.player_id,
      (totals.get(adjustment.player_id) ?? 0) + asNumber(adjustment.points)
    );
  }
  return totals;
}

export function deriveStandings(
  source: PublicDataSource,
  seasonId: string,
  eventId: string | null = null
): StandingsRow[] {
  type Aggregate = {
    player_id: string;
    display_name: string;
    rows: DerivedFinalResult[];
  };

  const model = modelFor(source);
  const season = model.seasonsById.get(seasonId);
  const aggregates = new Map<string, Aggregate>();
  for (const result of resultsForScope(model, seasonId, eventId)) {
    const aggregate = aggregates.get(result.player_id) ?? {
      player_id: result.player_id,
      display_name: result.display_name,
      rows: []
    };
    aggregate.rows.push(result);
    aggregates.set(result.player_id, aggregate);
  }

  const adjustments = adjustmentPointsByPlayer(model, seasonId, eventId);
  const event = eventId ? model.eventsById.get(eventId) : null;
  const showRating = isRatingSeason(season, model.ratingStartDate);
  const rows = Array.from(aggregates.values()).map((aggregate): StandingsRow => {
    const games = aggregate.rows.length;
    const totalPoints = aggregate.rows.reduce((total, row) => total + row.club_points, 0);
    const adjustmentPoints = adjustments.get(aggregate.player_id) ?? 0;
    const firsts = aggregate.rows.filter((row) => row.placement === 1).length;
    const seconds = aggregate.rows.filter((row) => row.placement === 2).length;
    const thirds = aggregate.rows.filter((row) => row.placement === 3).length;
    const fourths = aggregate.rows.filter((row) => row.placement === 4).length;
    const rating = model.lifetimeRatings.stateByPlayerId.get(aggregate.player_id);

    return {
      season_id: seasonId,
      ...(eventId
        ? {
            casual_event_id: eventId,
            casual_event_name: event?.name ?? null
          }
        : {}),
      player_id: aggregate.player_id,
      display_name: aggregate.display_name,
      games_played: games,
      total_points: totalPoints,
      avg_placement:
        aggregate.rows.reduce((total, row) => total + row.placement, 0) / games,
      avg_points: totalPoints / games,
      firsts,
      seconds,
      thirds,
      fourths,
      top2_rate:
        aggregate.rows.filter((row) => row.placement <= 2).length / games,
      fourth_rate: fourths / games,
      tobi_rate: aggregate.rows.filter((row) => row.tobi).length / games,
      adjustment_points: adjustmentPoints,
      total_points_with_adjustments: totalPoints + adjustmentPoints,
      rank: 0,
      rating: showRating ? (rating?.rate ?? null) : null,
      ...playerNameParts(model.playersById, aggregate.player_id)
    };
  });

  rows.sort(
    (left, right) =>
      right.total_points_with_adjustments - left.total_points_with_adjustments ||
      left.player_id.localeCompare(right.player_id)
  );
  let rank = 0;
  let previousPoints: number | null = null;
  for (const row of rows) {
    if (previousPoints == null || row.total_points_with_adjustments !== previousPoints) {
      rank += 1;
      previousPoints = row.total_points_with_adjustments;
    }
    row.rank = rank;
  }

  return rows;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function comparePointExtreme(
  left: DerivedFinalResult,
  right: DerivedFinalResult,
  direction: 1 | -1
): number {
  return (
    direction * (left.club_points - right.club_points) ||
    -compareDateText(left.played_at, right.played_at) ||
    right.match_id.localeCompare(left.match_id)
  );
}

export function derivePlayerStats(
  source: PublicDataSource,
  seasonId: string,
  playerId: string,
  eventId: string | null = null
): PlayerStats | null {
  const model = modelFor(source);
  const rows = resultsForScope(model, seasonId, eventId).filter(
    (row) => row.player_id === playerId
  );
  if (rows.length === 0) return null;

  const points = rows.map((row) => row.club_points);
  const totalPoints = points.reduce((total, value) => total + value, 0);
  const averagePoints = totalPoints / rows.length;
  const firsts = rows.filter((row) => row.placement === 1).length;
  const seconds = rows.filter((row) => row.placement === 2).length;
  const thirds = rows.filter((row) => row.placement === 3).length;
  const fourths = rows.filter((row) => row.placement === 4).length;
  const best = [...rows].sort((left, right) => comparePointExtreme(left, right, -1))[0];
  const worst = [...rows].sort((left, right) => comparePointExtreme(left, right, 1))[0];
  const last = [...rows].sort((left, right) => -compareResultsAscending(left, right))[0];
  const event = eventId ? model.eventsById.get(eventId) : null;

  return {
    season_id: seasonId,
    ...(eventId
      ? {
          casual_event_id: eventId,
          casual_event_name: event?.name ?? null
        }
      : {}),
    player_id: playerId,
    display_name: rows[0].display_name,
    games_played: rows.length,
    total_points: totalPoints,
    avg_placement: rows.reduce((total, row) => total + row.placement, 0) / rows.length,
    avg_points: averagePoints,
    firsts,
    seconds,
    thirds,
    fourths,
    top2_rate: rows.filter((row) => row.placement <= 2).length / rows.length,
    first_rate: firsts / rows.length,
    fourth_rate: fourths / rows.length,
    stdev_points: Math.sqrt(
      points.reduce((total, value) => total + (value - averagePoints) ** 2, 0) /
        points.length
    ),
    median_points: median(points),
    best_points: best.club_points,
    worst_points: worst.club_points,
    last_played_at: last.played_at,
    best_match_id: best.match_id,
    best_played_at: best.played_at,
    worst_match_id: worst.match_id,
    worst_played_at: worst.played_at
  };
}

function deriveRecentMatches(
  model: PublicDataModel,
  seasonId: string,
  eventId: string | null
): RecentMatchSummary[] {
  const matches = Array.from(model.matchesById.values())
    .filter(
      (match) =>
        match.season_id === seasonId &&
        (eventId == null || match.casual_event_id === eventId)
    )
    .sort((left, right) => -compareMatchesAscending(left, right))
    .slice(0, 10);

  return matches.map((match) => {
    const rows = model.resultsByMatchId.get(match.id) ?? [];
    const winner = rows.find((row) => row.placement === 1) ?? null;
    const rawPoints = rows.map((row) => row.raw_points);
    const clubPoints = rows.map((row) => row.club_points);
    const names = winner ? playerNameParts(model.playersById, winner.player_id) : null;
    const winnerName = names
      ? names.player_name_secondary
        ? `${names.player_name_primary} (${names.player_name_secondary})`
        : names.player_name_primary
      : null;

    return {
      ...match,
      winner_name_primary: names?.player_name_primary ?? null,
      winner_name_secondary: names?.player_name_secondary ?? null,
      winner_name: winnerName,
      winner_player_id: winner?.player_id ?? null,
      top_raw_points: rawPoints.length > 0 ? Math.max(...rawPoints) : null,
      sp_spread:
        clubPoints.length > 0 ? Math.max(...clubPoints) - Math.min(...clubPoints) : null
    };
  });
}

export function deriveSeasonsPage(source: PublicDataSource): SeasonsPageData {
  const model = modelFor(source);
  return {
    seasons: [...model.snapshot.seasons].sort(seasonStartDescending)
  };
}

export function deriveSeasonPage(
  source: PublicDataSource,
  seasonId: string,
  options: SeasonPageOptions = {}
): SeasonPageData | null {
  const model = modelFor(source);
  const season = model.seasonsById.get(seasonId);
  if (!season) return null;

  const isCasual = season.is_casual === true;
  const events = isCasual
    ? [...model.snapshot.casual_events].sort(
        (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
      )
    : [];
  const requestedEventId = clean(options.eventId);
  const eventId =
    isCasual && requestedEventId && model.eventsById.has(requestedEventId)
      ? requestedEventId
      : null;

  return {
    season,
    isCasual,
    isRatingSeason: isRatingSeason(season, model.ratingStartDate),
    events,
    eventId,
    competitiveSeason:
      model.snapshot.seasons.find(
        (candidate) => candidate.is_active && !candidate.is_casual
      ) ?? null,
    casualSeason:
      model.snapshot.seasons.find((candidate) => candidate.is_casual) ?? null,
    standings: deriveStandings(model, seasonId, eventId),
    recentMatches: deriveRecentMatches(model, seasonId, eventId)
  };
}

export function deriveMatchPage(
  source: PublicDataSource,
  matchId: string
): MatchPageData | null {
  const model = modelFor(source);
  const match = model.matchesById.get(matchId);
  if (!match) return null;

  const season = model.seasonsById.get(match.season_id) ?? null;
  const results = (model.resultsByMatchId.get(matchId) ?? []).map((row) => ({
    ...row,
    ...playerNameParts(model.playersById, row.player_id)
  }));
  const ratingDeltas = [
    ...(model.lifetimeRatings.historyByMatchId.get(matchId) ?? [])
  ].sort((left, right) => left.placement - right.placement);

  return {
    match,
    season,
    casualEvent: match.casual_event_id
      ? (model.eventsById.get(match.casual_event_id) ?? null)
      : null,
    isCasual: season?.is_casual === true,
    results,
    ratingDeltas
  };
}

function latestMatchRows(
  rows: readonly DerivedFinalResult[],
  maximum: number
): DerivedFinalResult[] {
  return [...rows]
    .sort((left, right) => -compareResultsAscending(left, right))
    .slice(0, maximum);
}

function chronologicalLatestRows(
  rows: readonly DerivedFinalResult[],
  maximum: number
): DerivedFinalResult[] {
  const chronological = [...rows].sort(compareResultsAscending);
  return chronological.slice(-maximum);
}

function matchAdjustmentTotal(
  adjustments: readonly PublicAdjustment[],
  matchId: string,
  playerId: string
): number {
  return adjustments
    .filter(
      (adjustment) =>
        adjustment.match_id === matchId && adjustment.player_id === playerId
    )
    .reduce((total, adjustment) => total + asNumber(adjustment.points), 0);
}

function rawExtreme(
  rows: readonly DerivedFinalResult[],
  direction: 1 | -1
): RawMatchExtreme | null {
  const row = [...rows].sort(
    (left, right) =>
      direction * (left.raw_points - right.raw_points) ||
      -compareDateText(left.played_at, right.played_at) ||
      right.match_id.localeCompare(left.match_id)
  )[0];
  return row
    ? {
        match_id: row.match_id,
        played_at: row.played_at,
        raw_points: row.raw_points
      }
    : null;
}

function eligibleSeasonRank(
  standings: readonly StandingsRow[],
  playerId: string,
  isCasual: boolean
): number | null {
  if (isCasual) {
    return standings.find((row) => row.player_id === playerId)?.rank ?? null;
  }

  const rankRemap = new Map<number, number>();
  let nextRank = 1;
  for (const row of standings) {
    if (row.games_played <= 4) continue;
    if (!rankRemap.has(row.rank)) {
      rankRemap.set(row.rank, nextRank);
      nextRank += 1;
    }
    if (row.player_id === playerId) return rankRemap.get(row.rank) ?? null;
  }
  return null;
}

export function derivePlayerPage(
  source: PublicDataSource,
  playerId: string,
  options: PlayerPageOptions = {}
): PlayerPageData | null {
  const model = modelFor(source);
  const sourcePlayer = model.playersById.get(playerId);
  if (!sourcePlayer) return null;

  const seasons = [...model.snapshot.seasons].sort(seasonStartDescending);
  const requestedSeasonId = clean(options.seasonId);
  const activeSeason =
    [...model.snapshot.seasons]
      .filter((season) => season.is_active && !season.is_casual)
      .sort((left, right) =>
        compareDateTextDescendingNullsLast(left.start_date, right.start_date)
      )[0] ?? null;
  const seasonId = requestedSeasonId || activeSeason?.id || null;
  const selectedSeason = seasonId ? (model.seasonsById.get(seasonId) ?? null) : null;
  const isCasualSeason = selectedSeason?.is_casual === true;
  const events = isCasualSeason
    ? [...model.snapshot.casual_events].sort(
        (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
      )
    : [];
  const requestedEventId = clean(options.eventId);
  const eventId =
    isCasualSeason && requestedEventId && model.eventsById.has(requestedEventId)
      ? requestedEventId
      : null;

  const currentRatingState = model.lifetimeRatings.stateByPlayerId.get(playerId);
  const currentRating = {
    rate: currentRatingState?.rate ?? 1500,
    games_played: currentRatingState?.games_played ?? 0,
    updated_at: currentRatingState?.updated_at ?? null
  };
  const name = playerNameParts(model.playersById, playerId);
  const profileMessageHtml = renderPlayerProfileMarkdown(sourcePlayer.profile_message_md);

  let stats: PlayerStats | null = null;
  let standingsRow: StandingsRow | null = null;
  let seasonEligibleRank: number | null = null;
  let matchHistory: PlayerMatchHistoryRow[] = [];
  let pointHistory: PlayerPointHistoryRow[] = [];
  let placementHistory: PlayerPlacementHistoryRow[] = [];
  let ratingHistory: RatingHistoryRow[] = [];
  let bestRawMatch: RawMatchExtreme | null = null;
  let worstRawMatch: RawMatchExtreme | null = null;

  if (seasonId) {
    const scopedRows = resultsForScope(model, seasonId, eventId).filter(
      (row) => row.player_id === playerId
    );
    const standings = deriveStandings(model, seasonId, eventId);
    stats = derivePlayerStats(model, seasonId, playerId, eventId);
    standingsRow = standings.find((row) => row.player_id === playerId) ?? null;
    seasonEligibleRank = eligibleSeasonRank(
      standings,
      playerId,
      isCasualSeason
    );

    matchHistory = latestMatchRows(scopedRows, 100).map((row) => {
      const match = model.matchesById.get(row.match_id)!;
      return {
        ...row,
        match_label: matchLabel(match)
      };
    });

    let cumulativePoints = 0;
    pointHistory = [...scopedRows].sort(compareResultsAscending).map((row) => {
      const match = model.matchesById.get(row.match_id)!;
      if (eventId) {
        const adjustmentPoints = matchAdjustmentTotal(
          model.snapshot.adjustments,
          row.match_id,
          playerId
        );
        const pointsWithAdjustments = row.club_points + adjustmentPoints;
        cumulativePoints += pointsWithAdjustments;
        return {
          season_id: row.season_id,
          casual_event_id: eventId,
          casual_event_name: model.eventsById.get(eventId)?.name ?? null,
          player_id: playerId,
          display_name: row.display_name,
          played_at: row.played_at,
          match_id: row.match_id,
          match_label: matchLabel(match),
          club_points: row.club_points,
          adjustment_points: adjustmentPoints,
          points_with_adjustments: pointsWithAdjustments,
          cumulative_points: cumulativePoints
        };
      }

      cumulativePoints += row.club_points;
      return {
        season_id: row.season_id,
        player_id: playerId,
        display_name: row.display_name,
        played_at: row.played_at,
        match_id: row.match_id,
        match_label: matchLabel(match),
        club_points: row.club_points,
        cumulative_points: cumulativePoints
      };
    }).slice(-200);

    placementHistory = chronologicalLatestRows(scopedRows, 200).map(
      (row): PlayerPlacementHistoryRow => ({
        season_id: row.season_id,
        player_id: playerId,
        display_name: row.display_name,
        played_at: row.played_at,
        match_id: row.match_id,
        match_label: matchLabel(model.matchesById.get(row.match_id)!),
        placement: row.placement,
        casual_event_id: row.casual_event_id,
        casual_event_name: row.casual_event_name
      })
    );

    if (
      selectedSeason &&
      isRatingSeason(selectedSeason, model.ratingStartDate) &&
      !isCasualSeason
    ) {
      const matchIds = new Set(scopedRows.map((row) => row.match_id));
      ratingHistory = (
        model.lifetimeRatings.historyByPlayerId.get(playerId) ?? []
      ).filter((row) => matchIds.has(row.match_id));
    }

    bestRawMatch = rawExtreme(scopedRows, -1);
    worstRawMatch = rawExtreme(scopedRows, 1);
  }

  return {
    player: {
      ...sourcePlayer,
      ...name
    },
    profileMessageHtml,
    profileMedia: profileMessageHtml
      ? classifyPlayerProfileMedia(sourcePlayer.profile_media_url)
      : null,
    canEditDisplay: false,
    seasons,
    seasonId,
    isCasualSeason,
    events,
    eventId,
    currentRating,
    currentRatingRank: currentRatingState?.rank ?? null,
    currentRatingRankTotal: model.lifetimeRatings.state.length,
    stats,
    standingsRow,
    seasonEligibleRank,
    matchHistory,
    pointHistory,
    placementHistory,
    ratingHistory,
    bestRawMatch,
    worstRawMatch
  };
}
