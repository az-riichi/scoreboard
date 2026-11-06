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
  MatchRatingRow,
  PlayerMatchHistoryRow,
  PlayerHistory,
  PlayerLifetime,
  PlayerLifetimeSeason,
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
  SeasonMatchesPageData,
  SeasonPageData,
  SeasonsPageData,
  StandingsRow
} from './types';

const FALLBACK_RATING_START_DATE = '2026-01-01';
const RECENT_MATCH_LIMIT = 10;

/** Selects every competition season on the player page. Casual stays separate, as it does for ratings. */
export const LIFETIME_SEASON_ID = 'lifetime';

export type PublicDataModel = {
  snapshot: PublicDataSnapshot;
  ratingStartDate: string;
  seasonsById: ReadonlyMap<string, PublicSeason>;
  eventsById: ReadonlyMap<string, PublicCasualEvent>;
  playersById: ReadonlyMap<string, RedactedPublicPlayer>;
  matchesById: ReadonlyMap<string, PublicFinalMatch>;
  matchesBySeasonId: ReadonlyMap<string, PublicFinalMatch[]>;
  results: DerivedFinalResult[];
  resultsByMatchId: ReadonlyMap<string, DerivedFinalResult[]>;
  resultsBySeasonId: ReadonlyMap<string, DerivedFinalResult[]>;
  resultsByPlayerId: ReadonlyMap<string, DerivedFinalResult[]>;
  adjustmentsByMatchId: ReadonlyMap<string | null, PublicAdjustment[]>;
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
const standingsCache = new WeakMap<
  PublicDataModel,
  Map<string, Map<string | null, StandingsRow[]>>
>();

function groupBy<T, K>(rows: readonly T[], keyFor: (row: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const row of rows) {
    const key = keyFor(row);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

function asNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

export function compareDateText(left: string | null, right: string | null): number {
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

export function compareMatchesAscending(left: PublicFinalMatch, right: PublicFinalMatch): number {
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

export function matchLabel(match: PublicFinalMatch): string {
  const explicit = clean(match.table_label);
  if (explicit) return explicit;
  if (match.table_mode && match.game_number) return `${match.table_mode}-${match.game_number}`;
  return match.id;
}

export function playerNameParts(
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

  return {
    history,
    state,
    stateByPlayerId,
    historyByMatchId: groupBy(history, (row) => row.match_id),
    historyByPlayerId: groupBy(history, (row) => row.player_id)
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
    matchesBySeasonId: groupBy(matches, (match) => match.season_id),
    results,
    resultsByMatchId,
    resultsBySeasonId: groupBy(results, (result) => result.season_id),
    resultsByPlayerId: groupBy(results, (result) => result.player_id),
    adjustmentsByMatchId: groupBy(snapshot.adjustments, (adjustment) => adjustment.match_id),
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
): readonly DerivedFinalResult[] {
  const rows = model.resultsBySeasonId.get(seasonId) ?? [];
  return eventId == null ? rows : rows.filter((result) => result.casual_event_id === eventId);
}

function resultsForPlayer(
  model: PublicDataModel,
  seasonId: string,
  playerId: string,
  eventId: string | null
): DerivedFinalResult[] {
  return (model.resultsByPlayerId.get(playerId) ?? []).filter(
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
  // Page consumers receive their own rows; mutating them must not poison the
  // standings reused by other player and season pages for this snapshot.
  return standingsForScope(modelFor(source), seasonId, eventId).map((row) => ({ ...row }));
}

function standingsForScope(
  model: PublicDataModel,
  seasonId: string,
  eventId: string | null
): readonly StandingsRow[] {
  let seasons = standingsCache.get(model);
  if (!seasons) standingsCache.set(model, (seasons = new Map()));
  let events = seasons.get(seasonId);
  if (!events) seasons.set(seasonId, (events = new Map()));
  const cached = events.get(eventId);
  if (cached) return cached;

  type Aggregate = {
    player_id: string;
    display_name: string;
    games: number;
    points: number;
    placement: number;
    firsts: number;
    seconds: number;
    thirds: number;
    fourths: number;
    tobis: number;
  };

  const season = model.seasonsById.get(seasonId);
  const aggregates = new Map<string, Aggregate>();
  for (const result of resultsForScope(model, seasonId, eventId)) {
    const aggregate = aggregates.get(result.player_id) ?? {
      player_id: result.player_id,
      display_name: result.display_name,
      games: 0,
      points: 0,
      placement: 0,
      firsts: 0,
      seconds: 0,
      thirds: 0,
      fourths: 0,
      tobis: 0
    };
    aggregate.games += 1;
    aggregate.points += result.club_points;
    aggregate.placement += result.placement;
    aggregate.firsts += Number(result.placement === 1);
    aggregate.seconds += Number(result.placement === 2);
    aggregate.thirds += Number(result.placement === 3);
    aggregate.fourths += Number(result.placement === 4);
    aggregate.tobis += Number(result.tobi);
    aggregates.set(result.player_id, aggregate);
  }

  const adjustments = adjustmentPointsByPlayer(model, seasonId, eventId);
  const event = eventId ? model.eventsById.get(eventId) : null;
  const showRating = isRatingSeason(season, model.ratingStartDate);
  const rows = Array.from(aggregates.values()).map((aggregate): StandingsRow => {
    const { games, points: totalPoints, firsts, seconds, thirds, fourths } = aggregate;
    const adjustmentPoints = adjustments.get(aggregate.player_id) ?? 0;
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
      avg_placement: aggregate.placement / games,
      avg_points: totalPoints / games,
      firsts,
      seconds,
      thirds,
      fourths,
      top2_rate: (firsts + seconds) / games,
      fourth_rate: fourths / games,
      tobi_rate: aggregate.tobis / games,
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

  events.set(eventId, rows);
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
  return playerStatsForRows(
    model,
    seasonId,
    playerId,
    eventId,
    resultsForPlayer(model, seasonId, playerId, eventId)
  );
}

function playerStatsForRows(
  model: PublicDataModel,
  seasonId: string,
  playerId: string,
  eventId: string | null,
  rows: readonly DerivedFinalResult[]
): PlayerStats | null {
  if (rows.length === 0) return null;

  const points: number[] = [];
  let totalPoints = 0;
  let totalPlacement = 0;
  const placements = [0, 0, 0, 0];
  let best = rows[0];
  let worst = rows[0];
  let last = rows[0];
  for (const row of rows) {
    points.push(row.club_points);
    totalPoints += row.club_points;
    totalPlacement += row.placement;
    placements[row.placement - 1] += 1;
    if (comparePointExtreme(row, best, -1) < 0) best = row;
    if (comparePointExtreme(row, worst, 1) < 0) worst = row;
    if (compareResultsAscending(row, last) > 0) last = row;
  }
  const averagePoints = totalPoints / rows.length;
  const [firsts, seconds, thirds, fourths] = placements;
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
    avg_placement: totalPlacement / rows.length,
    avg_points: averagePoints,
    firsts,
    seconds,
    thirds,
    fourths,
    top2_rate: (firsts + seconds) / rows.length,
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

function matchesNewestFirst(
  model: PublicDataModel,
  seasonId: string,
  eventId: string | null
): PublicFinalMatch[] {
  return (model.matchesBySeasonId.get(seasonId) ?? [])
    .filter((match) => eventId == null || match.casual_event_id === eventId)
    .sort((left, right) => -compareMatchesAscending(left, right));
}

function summarizeMatches(
  model: PublicDataModel,
  matches: readonly PublicFinalMatch[]
): RecentMatchSummary[] {
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

function seasonEventScope(
  model: PublicDataModel,
  season: PublicSeason,
  requestedEventId: string | null | undefined
) {
  const isCasual = season.is_casual === true;
  const events = isCasual
    ? [...model.snapshot.casual_events].sort(
        (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
      )
    : [];
  const requested = clean(requestedEventId);
  const eventId = isCasual && requested && model.eventsById.has(requested) ? requested : null;
  return { isCasual, events, eventId };
}

export function deriveSeasonMatchesPage(
  source: PublicDataSource,
  seasonId: string,
  options: SeasonPageOptions = {}
): SeasonMatchesPageData | null {
  const model = modelFor(source);
  const season = model.seasonsById.get(seasonId);
  if (!season) return null;

  const { isCasual, events, eventId } = seasonEventScope(model, season, options.eventId);
  return {
    season,
    isCasual,
    events,
    eventId,
    matches: summarizeMatches(model, matchesNewestFirst(model, seasonId, eventId))
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

  const { isCasual, events, eventId } = seasonEventScope(model, season, options.eventId);
  const matches = matchesNewestFirst(model, seasonId, eventId);

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
    recentMatches: summarizeMatches(model, matches.slice(0, RECENT_MATCH_LIMIT)),
    matchCount: matches.length
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
  const ratingRows = model.lifetimeRatings.historyByMatchId.get(matchId) ?? [];

  return {
    match,
    season,
    casualEvent: match.casual_event_id
      ? (model.eventsById.get(match.casual_event_id) ?? null)
      : null,
    isCasual: season?.is_casual === true,
    results,
    ratingDeltas: withRatingRanks(model.lifetimeRatings.history, ratingRows),
    ratingTableAverage:
      ratingRows.length > 0
        ? ratingRows.reduce((total, row) => total + row.old_rate, 0) / ratingRows.length
        : null
  };
}

/** Ranks the same way as the lifetime rating state: tied rates share a rank. */
function ratingRank(rates: ReadonlyMap<string, number>, playerId: string): number | null {
  const own = rates.get(playerId);
  if (own == null) return null;

  const higherRates = new Set<number>();
  for (const rate of rates.values()) {
    if (rate > own) higherRates.add(rate);
  }
  return higherRates.size + 1;
}

function withRatingRanks(
  history: readonly RatingHistoryRow[],
  matchRows: readonly RatingHistoryRow[]
): MatchRatingRow[] {
  if (matchRows.length === 0) return [];

  // History is chronological, so this stops with every rate as it stood before the match.
  const rates = new Map<string, number>();
  for (const row of history) {
    if (row.match_id === matchRows[0].match_id) break;
    rates.set(row.player_id, row.new_rate);
  }

  const ranksBefore = new Map(
    matchRows.map((row) => [row.player_id, ratingRank(rates, row.player_id)])
  );
  for (const row of matchRows) rates.set(row.player_id, row.new_rate);

  return matchRows.map((row) => ({
    ...row,
    rank_before: ranksBefore.get(row.player_id) ?? null,
    rank_after: ratingRank(rates, row.player_id)!
  }));
}

function matchAdjustmentTotal(
  model: PublicDataModel,
  matchId: string,
  playerId: string
): number {
  let total = 0;
  for (const adjustment of model.adjustmentsByMatchId.get(matchId) ?? []) {
    if (adjustment.player_id === playerId) total += asNumber(adjustment.points);
  }
  return total;
}

function rawExtreme(
  rows: readonly DerivedFinalResult[],
  direction: 1 | -1
): RawMatchExtreme | null {
  let row: DerivedFinalResult | undefined;
  for (const candidate of rows) {
    if (
      !row ||
      (
        direction * (candidate.raw_points - row.raw_points) ||
        -compareDateText(candidate.played_at, row.played_at) ||
        row.match_id.localeCompare(candidate.match_id)
      ) < 0
    ) {
      row = candidate;
    }
  }
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

function historyForRows(
  model: PublicDataModel,
  playerId: string,
  eventId: string | null,
  rows: readonly DerivedFinalResult[]
): Omit<PlayerHistory, 'ratingHistory'> {
  const chronologicalRows = [...rows].sort(compareResultsAscending);

  const matchHistory = chronologicalRows.slice(-100).reverse().map((row) => {
    const match = model.matchesById.get(row.match_id)!;
    return {
      ...row,
      match_label: matchLabel(match)
    };
  });

  let cumulativePoints = 0;
  const historyStart = Math.max(0, chronologicalRows.length - 200);
  for (let index = 0; index < historyStart; index += 1) {
    const row = chronologicalRows[index];
    cumulativePoints +=
      row.club_points + (eventId ? matchAdjustmentTotal(model, row.match_id, playerId) : 0);
  }
  const pointHistory = chronologicalRows.slice(historyStart).map((row) => {
    const match = model.matchesById.get(row.match_id)!;
    if (eventId) {
      const adjustmentPoints = matchAdjustmentTotal(
        model,
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
        placement: row.placement,
        raw_points: row.raw_points,
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
      placement: row.placement,
      raw_points: row.raw_points,
      club_points: row.club_points,
      cumulative_points: cumulativePoints
    };
  });

  const placementHistory = chronologicalRows.slice(historyStart).map(
    (row): PlayerPlacementHistoryRow => ({
      season_id: row.season_id,
      player_id: playerId,
      display_name: row.display_name,
      played_at: row.played_at,
      match_id: row.match_id,
      match_label: matchLabel(model.matchesById.get(row.match_id)!),
      placement: row.placement,
      raw_points: row.raw_points,
      club_points: row.club_points,
      casual_event_id: row.casual_event_id,
      casual_event_name: row.casual_event_name
    })
  );

  return { matchHistory, pointHistory, placementHistory };
}

function competitionRowsFor(model: PublicDataModel, playerId: string): DerivedFinalResult[] {
  return (model.resultsByPlayerId.get(playerId) ?? []).filter(
    (result) => model.seasonsById.get(result.season_id)?.is_casual !== true
  );
}

function lifetimeFor(
  model: PublicDataModel,
  playerId: string,
  rows: readonly DerivedFinalResult[]
): PlayerLifetime {
  const seasons = model.snapshot.seasons
    .filter((season) => !season.is_casual)
    .sort(seasonStartDescending)
    .flatMap((season): PlayerLifetimeSeason[] => {
      const standings = standingsForScope(model, season.id, null);
      const standing = standings.find((row) => row.player_id === playerId);
      if (!standing) return [];
      return [
        {
          season_id: season.id,
          season_name: season.name,
          is_active: season.is_active,
          games_played: standing.games_played,
          total_points: standing.total_points_with_adjustments,
          avg_placement: standing.avg_placement,
          top2_rate: standing.top2_rate,
          rank: eligibleSeasonRank(standings, playerId, false)
        }
      ];
    });
  const ranks = seasons.flatMap((season) => (season.rank == null ? [] : [season.rank]));
  const ratings = model.lifetimeRatings.historyByPlayerId.get(playerId) ?? [];

  return {
    seasons,
    total_points: seasons.reduce((total, season) => total + season.total_points, 0),
    titles: seasons.filter((season) => season.rank === 1 && !season.is_active).length,
    best_rank: ranks.length > 0 ? Math.min(...ranks) : null,
    peak_rating: ratings.length > 0 ? Math.max(...ratings.map((row) => row.new_rate)) : null,
    busts: rows.filter((row) => row.tobi).length
  };
}

function competitionHistoryFor(model: PublicDataModel, playerId: string): PlayerHistory {
  const history = historyForRows(model, playerId, null, competitionRowsFor(model, playerId));
  const shownMatchIds = new Set(history.pointHistory.map((row) => row.match_id));
  return {
    ...history,
    ratingHistory: (model.lifetimeRatings.historyByPlayerId.get(playerId) ?? []).filter((row) =>
      shownMatchIds.has(row.match_id)
    )
  };
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
  const isLifetime = requestedSeasonId === LIFETIME_SEASON_ID;
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
  let lifetime: PlayerLifetime | null = null;
  const competitionHistory = competitionHistoryFor(model, playerId);

  if (isLifetime) {
    const rows = competitionRowsFor(model, playerId);
    stats = playerStatsForRows(model, LIFETIME_SEASON_ID, playerId, null, rows);
    ({ matchHistory, pointHistory, placementHistory, ratingHistory } = competitionHistory);
    bestRawMatch = rawExtreme(rows, -1);
    worstRawMatch = rawExtreme(rows, 1);
    lifetime = lifetimeFor(model, playerId, rows);
  } else if (seasonId) {
    const scopedRows = resultsForPlayer(model, seasonId, playerId, eventId);
    const standings = standingsForScope(model, seasonId, eventId);
    stats = playerStatsForRows(model, seasonId, playerId, eventId, scopedRows);
    const standing = standings.find((row) => row.player_id === playerId);
    standingsRow = standing ? { ...standing } : null;
    seasonEligibleRank = eligibleSeasonRank(
      standings,
      playerId,
      isCasualSeason
    );

    ({ matchHistory, pointHistory, placementHistory } = historyForRows(
      model,
      playerId,
      eventId,
      scopedRows
    ));

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
    competitionHistory,
    isLifetime,
    lifetime,
    bestRawMatch,
    worstRawMatch
  };
}
