import { fmtDateArizona, toArizonaDatetimeLocalValue } from '../arizona-time';
import { fmtFixed, fmtNum, fmtPct, fmtSigned } from '../ui';
import {
  compareDateText,
  compareMatchesAscending,
  derivePublicData,
  deriveStandings,
  matchLabel,
  playerNameParts,
  type PublicDataModel
} from './derive';
import type {
  DerivedFinalResult,
  PlayerNameParts,
  PublicDataSnapshot,
  PublicFinalMatch,
  PublicSeason
} from './types';

/** Rate-based records need a real sample. A season uses the standings' eligibility rule. */
const SEASON_MIN_GAMES = 5;
const ALL_TIME_MIN_GAMES = 20;
const SEASON_MIN_MEETINGS = 4;
const ALL_TIME_MIN_MEETINGS = 8;
/** How far past zero a player must get before a reversal is a comeback or collapse. */
const SWING_MIN_DEPTH = 40;
const SESSION_MIN_GAMES = 2;
const STREAK_MIN_LENGTH = 2;
const ENTRIES_PER_RECORD = 3;
const PODIUM_SIZE = 3;

export type HallTone = 'glory' | 'shame' | 'neutral';

export type HallPlayer = PlayerNameParts & {
  player_id: string;
  href: string;
};

export type HallSeat = {
  player_id: string;
  name: string;
  raw_points: number;
  place: number;
  is_holder: boolean;
};

export type HallEntry = {
  rank: number;
  value: number;
  valueText: string;
  players: HallPlayer[];
  /** Word between two players, such as "over" or "vs". */
  joiner: string | null;
  detail: string;
  href: string;
  /** The whole table's final scores, for records set in one match. */
  table: HallSeat[] | null;
  /** The streak is still alive in the active season. */
  ongoing: boolean;
};

export type HallRecord = {
  key: string;
  title: string;
  description: string;
  tone: HallTone;
  entries: HallEntry[];
  /** Entries equal to the last shown entry that did not fit. */
  moreTied: number;
};

export type HallGroup = {
  key: string;
  title: string;
  records: HallRecord[];
};

export type HallPodiumRow = PlayerNameParts & {
  rank: number;
  player_id: string;
  href: string;
  points: number;
  games: number;
};

export type HallPodium = {
  season: PublicSeason;
  rows: HallPodiumRow[];
};

export type HallScope = {
  id: string | null;
  label: string;
  href: string;
};

export type HallOfFamePageData = {
  scopes: HallScope[];
  seasonId: string | null;
  season: PublicSeason | null;
  isAllTime: boolean;
  minGames: number;
  minMeetings: number;
  gameCount: number;
  playerCount: number;
  podiums: HallPodium[];
  matchGroups: HallGroup[];
  playerGroups: HallGroup[];
};

export type HallOfFameOptions = {
  seasonId?: string | null;
};

type GameRow = DerivedFinalResult & { place: number };
type Game = { match: PublicFinalMatch; rows: GameRow[] };
type EntryBody = Omit<HallEntry, 'rank'>;
type Direction = 'highest' | 'lowest';
type RecordMeta = Pick<HallRecord, 'key' | 'title' | 'description' | 'tone'>;

/** `rankKey` decides order and ties; `at` lets whoever got there first lead a tie. */
type Candidate = { rankKey: number; at: string | null; entry: EntryBody };

type Context = {
  model: PublicDataModel;
  games: Game[];
  isAllTime: boolean;
  seasonId: string | null;
  minGames: number;
  minMeetings: number;
};

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function games(count: number): string {
  return `${count} ${count === 1 ? 'game' : 'games'}`;
}

function gameFor(model: PublicDataModel, match: PublicFinalMatch): Game {
  const results = model.resultsByMatchId.get(match.id) ?? [];
  return {
    match,
    // Tied scores share a place, as on the match page. `placement` splits them by seat.
    rows: results.map((row) => ({
      ...row,
      place: 1 + results.filter((other) => other.raw_points > row.raw_points).length
    }))
  };
}

function seasonName(ctx: Context, seasonId: string): string {
  return ctx.model.seasonsById.get(seasonId)?.name ?? 'Unknown season';
}

function hallPlayer(ctx: Context, playerId: string, seasonId: string | null): HallPlayer {
  return {
    player_id: playerId,
    href: seasonId ? `/player/${playerId}?season=${seasonId}` : `/player/${playerId}`,
    ...playerNameParts(ctx.model.playersById, playerId)
  };
}

/** Records in the all-time view say which season they came from. */
function detailLine(ctx: Context, parts: readonly string[], seasonLabel: string | null): string {
  return (ctx.isAllTime && seasonLabel ? [...parts, seasonLabel] : parts).join(' · ');
}

function buildRecord(
  meta: RecordMeta,
  candidates: readonly Candidate[],
  direction: Direction
): HallRecord {
  const sign = direction === 'highest' ? -1 : 1;
  const ranked = [...candidates].sort(
    (left, right) => sign * (left.rankKey - right.rankKey) || compareDateText(left.at, right.at)
  );
  const shown = ranked.slice(0, ENTRIES_PER_RECORD);

  let rank = 0;
  const entries = shown.map((candidate, index) => {
    if (index === 0 || candidate.rankKey !== shown[index - 1].rankKey) rank = index + 1;
    return { ...candidate.entry, rank };
  });

  const last = shown[shown.length - 1];
  return {
    ...meta,
    entries,
    moreTied: ranked.slice(shown.length).filter((row) => row.rankKey === last.rankKey).length
  };
}

function matchEntry(
  ctx: Context,
  game: Game,
  value: number,
  valueText: string,
  holderIds: readonly string[],
  joiner: string | null = null
): EntryBody {
  const { match } = game;
  return {
    value,
    valueText,
    players: holderIds.map((id) => hallPlayer(ctx, id, match.season_id)),
    joiner,
    detail: detailLine(
      ctx,
      [fmtDateArizona(match.played_at), matchLabel(match)],
      seasonName(ctx, match.season_id)
    ),
    href: `/match/${match.id}`,
    table: game.rows.map((row) => ({
      player_id: row.player_id,
      name: playerNameParts(ctx.model.playersById, row.player_id).player_name_primary,
      raw_points: row.raw_points,
      place: row.place,
      is_holder: holderIds.includes(row.player_id)
    })),
    ongoing: false
  };
}

function scoreRecord(
  ctx: Context,
  meta: RecordMeta,
  direction: Direction,
  place: number | null
): HallRecord {
  const candidates = ctx.games.flatMap((game) =>
    game.rows
      .filter((row) => place == null || row.place === place)
      .map((row) => ({
        rankKey: row.raw_points,
        at: game.match.played_at,
        entry: matchEntry(ctx, game, row.raw_points, fmtNum(row.raw_points, 0), [row.player_id])
      }))
  );
  return buildRecord(meta, candidates, direction);
}

function gapRecord(
  ctx: Context,
  meta: RecordMeta,
  direction: Direction,
  lowerIndex: 1 | 3
): HallRecord {
  const candidates = ctx.games.map((game) => {
    const upper = game.rows[0];
    const lower = game.rows[lowerIndex];
    const gap = upper.raw_points - lower.raw_points;
    return {
      rankKey: gap,
      at: game.match.played_at,
      entry: matchEntry(
        ctx,
        game,
        gap,
        fmtNum(gap, 0),
        [upper.player_id, lower.player_id],
        gap === 0 ? 'tied with' : 'over'
      )
    };
  });
  return buildRecord(meta, candidates, direction);
}

function sticksRecord(ctx: Context, meta: RecordMeta): HallRecord {
  const candidates = ctx.games
    .filter((game) => Number(game.match.extra_sticks) > 0)
    .map((game) => {
      const sticks = Number(game.match.extra_sticks);
      return {
        rankKey: sticks,
        at: game.match.played_at,
        entry: matchEntry(ctx, game, sticks, fmtNum(sticks, 0), [])
      };
    });
  return buildRecord(meta, candidates, 'highest');
}

/** Winners who sat furthest below their table's R when the game began. */
function giantKillerRecord(ctx: Context, meta: RecordMeta): HallRecord {
  const candidates: Candidate[] = [];
  for (const game of ctx.games) {
    const ratings = ctx.model.lifetimeRatings.historyByMatchId.get(game.match.id) ?? [];
    if (ratings.length !== game.rows.length) continue;

    for (const winner of game.rows.filter((row) => row.place === 1)) {
      const others = ratings.filter((row) => row.player_id !== winner.player_id);
      const own = ratings.find((row) => row.player_id === winner.player_id);
      if (!own || others.length === 0) continue;

      const gap =
        others.reduce((total, row) => total + row.old_rate, 0) / others.length - own.old_rate;
      if (round1(gap) <= 0) continue;
      candidates.push({
        rankKey: round1(gap),
        at: game.match.played_at,
        entry: matchEntry(ctx, game, gap, `+${fmtNum(gap, 0)} R`, [winner.player_id])
      });
    }
  }
  return buildRecord(meta, candidates, 'highest');
}

function rowsByPlayer(chronological: readonly Game[]): Map<string, GameRow[]> {
  const rows = new Map<string, GameRow[]>();
  for (const game of chronological) {
    for (const row of game.rows) {
      const group = rows.get(row.player_id);
      if (group) group.push(row);
      else rows.set(row.player_id, [row]);
    }
  }
  return rows;
}

/** SP resets each season, so a reversal only means something inside one season. */
function rowsByPlayerSeason(ctx: Context): GameRow[][] {
  const tracks = new Map<string, GameRow[]>();
  for (const game of ctx.games) {
    for (const row of game.rows) {
      const key = `${row.season_id}|${row.player_id}`;
      const track = tracks.get(key);
      if (track) track.push(row);
      else tracks.set(key, [row]);
    }
  }
  return [...tracks.values()];
}

/**
 * A comeback fell at least SWING_MIN_DEPTH below zero and climbed back above it.
 * A collapse is the same walk with the signs flipped.
 */
function swingRecord(ctx: Context, meta: RecordMeta, sign: 1 | -1): HallRecord {
  const candidates: Candidate[] = [];
  for (const rows of rowsByPlayerSeason(ctx)) {
    let running = 0;
    let turn = 0;
    let turnIndex = -1;
    let best: { swing: number; from: number; to: number; games: number; row: GameRow } | null =
      null;

    for (const [index, row] of rows.entries()) {
      running += sign * row.club_points;
      if (running < turn) {
        turn = running;
        turnIndex = index;
      }
      const swing = running - turn;
      if (turn <= -SWING_MIN_DEPTH && running > 0 && swing > (best?.swing ?? 0)) {
        best = { swing, from: sign * turn, to: sign * running, games: index - turnIndex, row };
      }
    }

    if (!best) continue;
    const { swing, from, to, games: gameCount, row } = best;
    const player = hallPlayer(ctx, row.player_id, row.season_id);
    candidates.push({
      rankKey: round1(swing),
      at: row.played_at,
      entry: {
        value: sign * swing,
        valueText: fmtSigned(sign * swing, 1, true),
        players: [player],
        joiner: null,
        detail: detailLine(
          ctx,
          [`${fmtSigned(from, 1, true)} → ${fmtSigned(to, 1, true)} in ${games(gameCount)}`],
          seasonName(ctx, row.season_id)
        ),
        href: player.href,
        table: null,
        ongoing: false
      }
    });
  }
  return buildRecord(meta, candidates, 'highest');
}

function sessionCandidates(ctx: Context): (Candidate & { total: number })[] {
  const sessions = new Map<string, GameRow[]>();
  for (const game of ctx.games) {
    const date = toArizonaDatetimeLocalValue(game.match.played_at).slice(0, 10);
    for (const row of game.rows) {
      const key = `${row.season_id}|${date}|${row.player_id}`;
      const session = sessions.get(key);
      if (session) session.push(row);
      else sessions.set(key, [row]);
    }
  }

  return [...sessions.values()]
    .filter((rows) => rows.length >= SESSION_MIN_GAMES)
    .map((rows) => {
      const first = rows[0];
      const total = rows.reduce((sum, row) => sum + row.club_points, 0);
      const wins = rows.filter((row) => row.place === 1).length;
      const player = hallPlayer(ctx, first.player_id, first.season_id);
      return {
        total,
        rankKey: round1(total),
        at: first.played_at,
        entry: {
          value: total,
          valueText: fmtSigned(total, 1, true),
          players: [player],
          joiner: null,
          detail: detailLine(
            ctx,
            [
              fmtDateArizona(first.played_at),
              `${wins} of ${games(rows.length)} won`
            ],
            seasonName(ctx, first.season_id)
          ),
          href: player.href,
          table: null,
          ongoing: false
        }
      };
    });
}

/**
 * All-time streaks follow the competition seasons as one timeline. Casual games
 * overlap that calendar, so they run separately rather than break a season's
 * streak; every season's record therefore stands in the all-time view too.
 */
function streakTimelines(ctx: Context): Game[][] {
  if (!ctx.isAllTime) return [ctx.games];
  const isCasual = (game: Game) =>
    ctx.model.seasonsById.get(game.match.season_id)?.is_casual === true;
  return [ctx.games.filter((game) => !isCasual(game)), ctx.games.filter(isCasual)];
}

function streakRecord(
  ctx: Context,
  meta: RecordMeta,
  inStreak: (row: GameRow) => boolean
): HallRecord {
  type Run = { length: number; first: GameRow; last: GameRow; ongoing: boolean };
  const bestByPlayer = new Map<string, Run>();

  for (const timeline of streakTimelines(ctx)) {
    for (const [playerId, rows] of rowsByPlayer(timeline)) {
      let start = 0;
      let best: Run | null = null;
      for (const [index, row] of rows.entries()) {
        if (!inStreak(row)) {
          start = index + 1;
          continue;
        }
        const length = index - start + 1;
        if (length > (best?.length ?? 0)) {
          best = { length, first: rows[start], last: row, ongoing: false };
        }
      }

      if (!best) continue;
      best.ongoing =
        best.last === rows[rows.length - 1] &&
        ctx.model.seasonsById.get(best.last.season_id)?.is_active === true;

      const current = bestByPlayer.get(playerId);
      if (!current || best.length > current.length) bestByPlayer.set(playerId, best);
    }
  }

  const candidates: Candidate[] = [];
  for (const [playerId, run] of bestByPlayer) {
    if (run.length < STREAK_MIN_LENGTH) continue;
    const firstDate = fmtDateArizona(run.first.played_at);
    const lastDate = fmtDateArizona(run.last.played_at);
    const firstSeason = seasonName(ctx, run.first.season_id);
    const lastSeason = seasonName(ctx, run.last.season_id);
    const player = hallPlayer(ctx, playerId, ctx.seasonId);
    candidates.push({
      rankKey: run.length,
      at: run.last.played_at,
      entry: {
        value: run.length,
        valueText: games(run.length),
        players: [player],
        joiner: null,
        detail: detailLine(
          ctx,
          [firstDate === lastDate ? firstDate : `${firstDate} → ${lastDate}`],
          firstSeason === lastSeason ? firstSeason : `${firstSeason} → ${lastSeason}`
        ),
        href: player.href,
        table: null,
        ongoing: run.ongoing
      }
    });
  }
  return buildRecord(meta, candidates, 'highest');
}

function playerEntry(
  ctx: Context,
  playerId: string,
  value: number,
  valueText: string,
  detail: string
): EntryBody {
  const player = hallPlayer(ctx, playerId, ctx.seasonId);
  return {
    value,
    valueText,
    players: [player],
    joiner: null,
    detail,
    href: player.href,
    table: null,
    ongoing: false
  };
}

function placeShareRecord(ctx: Context, meta: RecordMeta, place: number): HallRecord {
  const candidates: Candidate[] = [];
  for (const [playerId, rows] of rowsByPlayer(ctx.games)) {
    if (rows.length < ctx.minGames) continue;
    const count = rows.filter((row) => row.place === place).length;
    if (count === 0) continue;
    const share = count / rows.length;
    candidates.push({
      rankKey: Math.round(share * 1000),
      at: rows[rows.length - 1].played_at,
      entry: playerEntry(ctx, playerId, share, fmtPct(share), `${count} of ${games(rows.length)}`)
    });
  }
  return buildRecord(meta, candidates, 'highest');
}

function volatilityRecord(ctx: Context, meta: RecordMeta, direction: Direction): HallRecord {
  const candidates: Candidate[] = [];
  for (const [playerId, rows] of rowsByPlayer(ctx.games)) {
    if (rows.length < ctx.minGames) continue;
    const points = rows.map((row) => row.club_points);
    const mean = points.reduce((total, value) => total + value, 0) / points.length;
    const deviation = Math.sqrt(
      points.reduce((total, value) => total + (value - mean) ** 2, 0) / points.length
    );
    candidates.push({
      rankKey: round1(deviation),
      at: rows[rows.length - 1].played_at,
      entry: playerEntry(
        ctx,
        playerId,
        deviation,
        `±${fmtFixed(deviation, 1)}`,
        `${fmtSigned(Math.max(...points), 1, true)} best, ${fmtSigned(Math.min(...points), 1, true)} worst`
      )
    });
  }
  return buildRecord(meta, candidates, direction);
}

function bustRecord(ctx: Context, meta: RecordMeta): HallRecord {
  const candidates: Candidate[] = [];
  for (const [playerId, rows] of rowsByPlayer(ctx.games)) {
    const busts = rows.filter((row) => row.tobi);
    if (busts.length === 0) continue;
    candidates.push({
      rankKey: busts.length,
      at: busts[busts.length - 1].played_at,
      entry: playerEntry(
        ctx,
        playerId,
        busts.length,
        String(busts.length),
        `In ${busts.length} of ${games(rows.length)}`
      )
    });
  }
  return buildRecord(meta, candidates, 'highest');
}

function mostGamesRecord(ctx: Context, meta: RecordMeta): HallRecord {
  const candidates: Candidate[] = [];
  for (const [playerId, rows] of rowsByPlayer(ctx.games)) {
    const averagePlace = rows.reduce((total, row) => total + row.place, 0) / rows.length;
    candidates.push({
      rankKey: rows.length,
      at: rows[rows.length - 1].played_at,
      entry: playerEntry(
        ctx,
        playerId,
        rows.length,
        String(rows.length),
        `Average place ${fmtFixed(averagePlace, 2)}`
      )
    });
  }
  return buildRecord(meta, candidates, 'highest');
}

function peakRatingRecord(ctx: Context, meta: RecordMeta): HallRecord {
  const peaks = new Map<string, Candidate & { rate: number }>();
  for (const game of ctx.games) {
    for (const row of ctx.model.lifetimeRatings.historyByMatchId.get(game.match.id) ?? []) {
      const current = peaks.get(row.player_id);
      if (current && row.new_rate <= current.rate) continue;
      peaks.set(row.player_id, {
        rate: row.new_rate,
        rankKey: round1(row.new_rate),
        at: row.played_at,
        entry: {
          ...playerEntry(
            ctx,
            row.player_id,
            row.new_rate,
            fmtNum(row.new_rate, 0),
            detailLine(
              ctx,
              [fmtDateArizona(row.played_at)],
              seasonName(ctx, game.match.season_id)
            )
          ),
          href: `/match/${game.match.id}`
        }
      });
    }
  }
  return buildRecord(meta, [...peaks.values()], 'highest');
}

function seasonTotalRecord(ctx: Context, meta: RecordMeta, direction: Direction): HallRecord {
  const candidates: Candidate[] = [];
  for (const season of ctx.model.snapshot.seasons) {
    if (season.is_casual) continue;
    for (const row of deriveStandings(ctx.model, season.id)) {
      if (row.games_played < SEASON_MIN_GAMES) continue;
      const player = hallPlayer(ctx, row.player_id, season.id);
      candidates.push({
        rankKey: round1(row.total_points_with_adjustments),
        at: season.start_date,
        entry: {
          value: row.total_points_with_adjustments,
          valueText: fmtSigned(row.total_points_with_adjustments, 1, true),
          players: [player],
          joiner: null,
          detail: `${season.name} · ${games(row.games_played)}`,
          href: player.href,
          table: null,
          ongoing: false
        }
      });
    }
  }
  return buildRecord(meta, candidates, direction);
}

type HeadToHead = {
  leaderId: string;
  trailerId: string;
  wins: number;
  losses: number;
  draws: number;
  meetings: number;
  at: string;
};

function headToHeads(ctx: Context): HeadToHead[] {
  type Tally = { left: string; right: string; leftWins: number; rightWins: number; draws: number; at: string };
  const tallies = new Map<string, Tally>();

  for (const game of ctx.games) {
    for (let i = 0; i < game.rows.length; i += 1) {
      for (let j = i + 1; j < game.rows.length; j += 1) {
        const [a, b] = [game.rows[i], game.rows[j]];
        const [first, second] = a.player_id < b.player_id ? [a, b] : [b, a];
        const key = `${first.player_id}|${second.player_id}`;
        const tally = tallies.get(key) ?? {
          left: first.player_id,
          right: second.player_id,
          leftWins: 0,
          rightWins: 0,
          draws: 0,
          at: game.match.played_at
        };
        if (first.raw_points > second.raw_points) tally.leftWins += 1;
        else if (first.raw_points < second.raw_points) tally.rightWins += 1;
        else tally.draws += 1;
        tally.at = game.match.played_at;
        tallies.set(key, tally);
      }
    }
  }

  return [...tallies.values()].map((tally) => {
    const leftLeads = tally.leftWins >= tally.rightWins;
    return {
      leaderId: leftLeads ? tally.left : tally.right,
      trailerId: leftLeads ? tally.right : tally.left,
      wins: Math.max(tally.leftWins, tally.rightWins),
      losses: Math.min(tally.leftWins, tally.rightWins),
      draws: tally.draws,
      meetings: tally.leftWins + tally.rightWins + tally.draws,
      at: tally.at
    };
  });
}

function scoreline(pair: HeadToHead): string {
  return `${pair.wins}–${pair.losses}${pair.draws ? `–${pair.draws}` : ''}`;
}

function pairEntry(
  ctx: Context,
  pair: HeadToHead,
  value: number,
  valueText: string,
  joiner: string,
  detail: string
): EntryBody {
  const leader = hallPlayer(ctx, pair.leaderId, ctx.seasonId);
  return {
    value,
    valueText,
    players: [leader, hallPlayer(ctx, pair.trailerId, ctx.seasonId)],
    joiner,
    detail,
    href: leader.href,
    table: null,
    ongoing: false
  };
}

function rivalryRecord(ctx: Context, meta: RecordMeta, pairs: readonly HeadToHead[]): HallRecord {
  const candidates = pairs
    .filter((pair) => pair.meetings >= ctx.minMeetings)
    .map((pair) => ({
      // Most meetings first; among those, the closest contest is the better rivalry.
      rankKey: pair.meetings * 1000 - (pair.wins - pair.losses),
      at: pair.at,
      entry: pairEntry(
        ctx,
        pair,
        pair.meetings,
        games(pair.meetings),
        'vs',
        pair.wins === pair.losses
          ? `Level at ${scoreline(pair)}`
          : `${playerNameParts(ctx.model.playersById, pair.leaderId).player_name_primary} leads ${scoreline(pair)}`
      )
    }));
  return buildRecord(meta, candidates, 'highest');
}

function nemesisRecord(ctx: Context, meta: RecordMeta, pairs: readonly HeadToHead[]): HallRecord {
  const candidates = pairs
    .filter((pair) => pair.meetings >= ctx.minMeetings && pair.wins > pair.losses)
    .map((pair) => {
      const lead = pair.wins - pair.losses;
      return {
        // Biggest lead first; a shorter series with that lead is the more one-sided.
        rankKey: lead * 1000 + Math.round((pair.wins / pair.meetings) * 100),
        at: pair.at,
        entry: pairEntry(ctx, pair, lead, scoreline(pair), 'over', `Finished higher in ${pair.wins} of ${games(pair.meetings)}`)
      };
    });
  return buildRecord(meta, candidates, 'highest');
}

function matchGroups(ctx: Context): HallGroup[] {
  return [
    {
      key: 'places',
      title: 'By finishing place',
      records: [
        scoreRecord(ctx, { key: 'highest-first', title: 'Highest win', description: 'Top score to finish 1st', tone: 'glory' }, 'highest', 1),
        scoreRecord(ctx, { key: 'lowest-first', title: 'Cheapest win', description: 'Lowest score to finish 1st', tone: 'neutral' }, 'lowest', 1),
        scoreRecord(ctx, { key: 'highest-second', title: 'Robbed', description: 'Highest score to finish only 2nd', tone: 'neutral' }, 'highest', 2),
        scoreRecord(ctx, { key: 'lowest-second', title: 'Lucky second', description: 'Lowest score to finish 2nd', tone: 'neutral' }, 'lowest', 2),
        scoreRecord(ctx, { key: 'highest-third', title: 'Stuck in third', description: 'Highest score to finish 3rd', tone: 'neutral' }, 'highest', 3),
        scoreRecord(ctx, { key: 'lowest-third', title: 'Great escape', description: 'Lowest score to finish 3rd and dodge last', tone: 'neutral' }, 'lowest', 3),
        scoreRecord(ctx, { key: 'highest-fourth', title: 'Unluckiest last', description: 'Highest score to finish 4th', tone: 'neutral' }, 'highest', 4),
        scoreRecord(ctx, { key: 'lowest-score', title: 'Rock bottom', description: 'Lowest score in a single game', tone: 'shame' }, 'lowest', null)
      ]
    },
    {
      key: 'margins',
      title: 'Margins and oddities',
      records: [
        gapRecord(ctx, { key: 'photo-finish', title: 'Photo finish', description: 'Smallest gap between 1st and 2nd', tone: 'neutral' }, 'lowest', 1),
        gapRecord(ctx, { key: 'runaway', title: 'Runaway', description: 'Biggest gap between 1st and 2nd', tone: 'glory' }, 'highest', 1),
        gapRecord(ctx, { key: 'blowout', title: 'Blowout', description: 'Biggest gap from 1st to 4th', tone: 'shame' }, 'highest', 3),
        gapRecord(ctx, { key: 'tightest-table', title: 'Tightest table', description: 'Smallest gap from 1st to 4th', tone: 'neutral' }, 'lowest', 3),
        sticksRecord(ctx, { key: 'sticks', title: 'Sticks on the table', description: 'Most points left unclaimed at the end of a game', tone: 'neutral' }),
        giantKillerRecord(ctx, { key: 'giant-killer', title: 'Giant killer', description: 'Won from furthest below the table’s average R', tone: 'glory' })
      ]
    }
  ];
}

function playerGroups(ctx: Context): HallGroup[] {
  const sessions = sessionCandidates(ctx);
  const pairs = headToHeads(ctx);
  const seasonTotals = ctx.isAllTime
    ? [
        seasonTotalRecord(ctx, { key: 'best-season', title: 'Best season', description: `Highest SP total in a season (${SEASON_MIN_GAMES}+ games)`, tone: 'glory' }, 'highest'),
        seasonTotalRecord(ctx, { key: 'worst-season', title: 'Worst season', description: `Lowest SP total in a season (${SEASON_MIN_GAMES}+ games)`, tone: 'shame' }, 'lowest')
      ]
    : [];

  return [
    {
      key: 'swings',
      title: 'Swings',
      records: [
        swingRecord(ctx, { key: 'comeback', title: 'Biggest comeback', description: `Fell ${SWING_MIN_DEPTH}+ SP below zero in a season, then climbed back above it`, tone: 'glory' }, 1),
        swingRecord(ctx, { key: 'collapse', title: 'Biggest collapse', description: `Rose ${SWING_MIN_DEPTH}+ SP above zero in a season, then fell back below it`, tone: 'shame' }, -1),
        buildRecord(
          { key: 'best-session', title: 'Best day', description: `Most SP gained in one day (${SESSION_MIN_GAMES}+ games)`, tone: 'glory' },
          sessions.filter((session) => session.total > 0),
          'highest'
        ),
        buildRecord(
          { key: 'worst-session', title: 'Worst day', description: `Most SP lost in one day (${SESSION_MIN_GAMES}+ games)`, tone: 'shame' },
          sessions.filter((session) => session.total < 0),
          'lowest'
        ),
        ...seasonTotals
      ]
    },
    {
      key: 'streaks',
      title: 'Streaks',
      records: [
        streakRecord(ctx, { key: 'win-streak', title: 'Hot hand', description: 'Most 1st places in a row', tone: 'glory' }, (row) => row.place === 1),
        streakRecord(ctx, { key: 'top-two-streak', title: 'Top-two run', description: 'Most games in a row finishing 1st or 2nd', tone: 'glory' }, (row) => row.place <= 2),
        streakRecord(ctx, { key: 'no-last-streak', title: 'Last-place dodger', description: 'Most games in a row without finishing 4th', tone: 'glory' }, (row) => row.place < 4),
        streakRecord(ctx, { key: 'winless-streak', title: 'The drought', description: 'Most games in a row without a win', tone: 'shame' }, (row) => row.place !== 1),
        streakRecord(ctx, { key: 'last-streak', title: 'Cursed', description: 'Most 4th places in a row', tone: 'shame' }, (row) => row.place === 4)
      ]
    },
    {
      key: 'style',
      title: 'Playing style',
      records: [
        placeShareRecord(ctx, { key: 'win-rate', title: 'Serial winner', description: `Highest share of 1st places (${ctx.minGames}+ games)`, tone: 'glory' }, 1),
        placeShareRecord(ctx, { key: 'second-rate', title: 'Always the bridesmaid', description: `Highest share of 2nd places (${ctx.minGames}+ games)`, tone: 'neutral' }, 2),
        volatilityRecord(ctx, { key: 'rollercoaster', title: 'Rollercoaster', description: `Widest spread of SP per game (${ctx.minGames}+ games)`, tone: 'neutral' }, 'highest'),
        volatilityRecord(ctx, { key: 'iron-wall', title: 'Iron wall', description: `Narrowest spread of SP per game (${ctx.minGames}+ games)`, tone: 'neutral' }, 'lowest'),
        bustRecord(ctx, { key: 'busts', title: 'Frequent flyer', description: 'Most games finished below zero', tone: 'shame' }),
        mostGamesRecord(ctx, { key: 'most-games', title: 'Always at the table', description: 'Most games played', tone: 'neutral' }),
        peakRatingRecord(ctx, { key: 'peak-rating', title: 'Peak rating', description: 'Highest R reached', tone: 'glory' })
      ]
    },
    {
      key: 'rivalries',
      title: 'Rivalries',
      records: [
        rivalryRecord(ctx, { key: 'rivalry', title: 'Old rivals', description: `Pair who shared a table most (${ctx.minMeetings}+ games)`, tone: 'neutral' }, pairs),
        nemesisRecord(ctx, { key: 'nemesis', title: 'Nemesis', description: `Most one-sided head-to-head (${ctx.minMeetings}+ games)`, tone: 'shame' }, pairs)
      ]
    }
  ];
}

function withoutEmptyRecords(groups: readonly HallGroup[]): HallGroup[] {
  return groups
    .map((group) => ({
      ...group,
      records: group.records.filter((record) => record.entries.length > 0)
    }))
    .filter((group) => group.records.length > 0);
}

function compareSeasonsNewestFirst(left: PublicSeason, right: PublicSeason): number {
  if (left.is_casual !== right.is_casual) return left.is_casual ? 1 : -1;
  return -compareDateText(left.start_date, right.start_date) || left.name.localeCompare(right.name);
}

function podiumFor(ctx: Context, season: PublicSeason): HallPodium | null {
  const standings = deriveStandings(ctx.model, season.id).filter(
    (row) => season.is_casual || row.games_played >= SEASON_MIN_GAMES
  );

  let rank = 0;
  let previousPoints: number | null = null;
  const rows = standings.slice(0, PODIUM_SIZE).map((row, index): HallPodiumRow => {
    if (row.total_points_with_adjustments !== previousPoints) {
      rank = index + 1;
      previousPoints = row.total_points_with_adjustments;
    }
    return {
      rank,
      player_id: row.player_id,
      href: `/player/${row.player_id}?season=${season.id}`,
      points: row.total_points_with_adjustments,
      games: row.games_played,
      player_name_primary: row.player_name_primary,
      player_name_secondary: row.player_name_secondary
    };
  });

  return rows.length > 0 ? { season, rows } : null;
}

/**
 * Derives the Hall of Fame for one season, or for every season when no season is
 * requested. Returns null for an unknown season. Each record keeps its top
 * entries, and a record nobody has set yet is left out.
 */
export function deriveHallOfFame(
  snapshot: PublicDataSnapshot,
  options: HallOfFameOptions = {}
): HallOfFamePageData | null {
  const model = derivePublicData(snapshot);
  const requestedSeasonId = String(options.seasonId ?? '').trim();
  const season = requestedSeasonId ? (model.seasonsById.get(requestedSeasonId) ?? null) : null;
  if (requestedSeasonId && !season) return null;

  const isAllTime = season == null;
  const matches = season
    ? (model.matchesBySeasonId.get(season.id) ?? [])
    : Array.from(model.matchesById.values());
  const ctx: Context = {
    model,
    games: [...matches].sort(compareMatchesAscending).map((match) => gameFor(model, match)),
    isAllTime,
    seasonId: season?.id ?? null,
    minGames: isAllTime ? ALL_TIME_MIN_GAMES : SEASON_MIN_GAMES,
    minMeetings: isAllTime ? ALL_TIME_MIN_MEETINGS : SEASON_MIN_MEETINGS
  };

  const seasons = [...snapshot.seasons].sort(compareSeasonsNewestFirst);
  const podiumSeasons = season ? [season] : seasons.filter((candidate) => !candidate.is_casual);

  return {
    scopes: [
      { id: null, label: 'All time', href: '/hall-of-fame' },
      ...seasons.map((candidate) => ({
        id: candidate.id,
        label: candidate.name,
        href: `/hall-of-fame?season=${candidate.id}`
      }))
    ],
    seasonId: ctx.seasonId,
    season,
    isAllTime,
    minGames: ctx.minGames,
    minMeetings: ctx.minMeetings,
    gameCount: ctx.games.length,
    playerCount: new Set(ctx.games.flatMap((game) => game.rows.map((row) => row.player_id))).size,
    podiums: podiumSeasons
      .map((candidate) => podiumFor(ctx, candidate))
      .filter((podium): podium is HallPodium => podium != null),
    matchGroups: withoutEmptyRecords(matchGroups(ctx)),
    playerGroups: withoutEmptyRecords(playerGroups(ctx))
  };
}
