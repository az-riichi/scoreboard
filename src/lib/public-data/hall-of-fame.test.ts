import { describe, expect, it } from 'vitest';
import { deriveHallOfFame, type HallOfFamePageData, type HallRecord } from './hall-of-fame';
import type {
  PublicDataSnapshot,
  PublicFinalMatch,
  PublicSeason,
  RawMatchResult,
  RedactedPublicPlayer
} from './types';

const SEATS = ['E', 'S', 'W', 'N'] as const;

function player(id: string): RedactedPublicPlayer {
  return {
    id,
    display_name: id.toUpperCase(),
    real_first_name: null,
    real_last_name: null,
    show_display_name: true,
    show_real_first_name: false,
    show_real_last_name: false,
    profile_message_md: null,
    profile_media_url: null,
    is_active: true
  };
}

function season(id: string, startDate: string | null, extra: Partial<PublicSeason> = {}): PublicSeason {
  return {
    id,
    name: id,
    start_date: startDate,
    end_date: startDate,
    is_active: false,
    is_casual: false,
    ...extra
  };
}

const SEASONS = [
  season('spring', '2026-01-14'),
  season('fall', '2026-09-02', { is_active: true }),
  season('casual', null, { is_casual: true })
];

type GameSpec = {
  season?: string;
  at: string;
  /** Player id and raw score, in seat order. */
  scores: readonly (readonly [string, number])[];
  sticks?: number;
};

function snapshot(games: readonly GameSpec[]): PublicDataSnapshot {
  const matches: PublicFinalMatch[] = [];
  const results: RawMatchResult[] = [];
  const playerIds = new Set<string>();

  games.forEach((game, index) => {
    const id = `m${String(index).padStart(3, '0')}`;
    const seasonId = game.season ?? 'spring';
    matches.push({
      id,
      season_id: seasonId,
      casual_event_id: null,
      ruleset_id: 'rules',
      game_number: index + 1,
      table_mode: 'A',
      extra_sticks: game.sticks ?? 0,
      include_in_lifetime_rating: seasonId !== 'casual',
      played_at: game.at,
      status: 'final',
      table_label: `A${index + 1}`,
      notes: null
    });
    game.scores.forEach(([playerId, raw], seat) => {
      playerIds.add(playerId);
      results.push({ match_id: id, seat: SEATS[seat], player_id: playerId, raw_points: raw });
    });
  });

  return {
    schema_version: 1,
    revision: { scope: 'scoreboard', revision: '1', changed_at: '2026-01-01T00:00:00Z' },
    seasons: SEASONS,
    casual_events: [],
    players: [...playerIds].map(player),
    rulesets: [
      {
        id: 'rules',
        name: 'Default',
        start_points: 25000,
        return_points: 25000,
        point_divisor: 1000,
        uma_1: 30,
        uma_2: 10,
        uma_3: -10,
        uma_4: -30,
        oka_1: 0,
        oka_2: 0,
        oka_3: 0,
        oka_4: 0
      }
    ],
    matches,
    match_results: results,
    adjustments: []
  };
}

/** A game where the named players finish 1st to 4th with evenly spaced scores. */
function ordered(at: string, order: string, spec: Partial<GameSpec> = {}): GameSpec {
  const raws = [40000, 30000, 20000, 10000];
  return {
    at,
    scores: order.split('').map((id, index) => [id, raws[index]] as const),
    ...spec
  };
}

function day(index: number): string {
  const date = new Date(Date.UTC(2026, 1, 1, 19));
  date.setUTCDate(date.getUTCDate() + index);
  return date.toISOString();
}

function fallDay(index: number): string {
  const date = new Date(Date.UTC(2026, 8, 10, 19));
  date.setUTCDate(date.getUTCDate() + index);
  return date.toISOString();
}

function derive(games: readonly GameSpec[], seasonId: string | null = null): HallOfFamePageData {
  const data = deriveHallOfFame(snapshot(games), { seasonId });
  if (!data) throw new Error('Expected Hall of Fame data');
  return data;
}

function record(data: HallOfFamePageData, key: string): HallRecord | undefined {
  return [...data.matchGroups, ...data.playerGroups]
    .flatMap((group) => group.records)
    .find((candidate) => candidate.key === key);
}

function holders(data: HallOfFamePageData, key: string): (string | number)[][] {
  return (record(data, key)?.entries ?? []).map((entry) => [
    entry.players.map((holder) => holder.player_id).join('+'),
    entry.value
  ]);
}

describe('deriveHallOfFame scope', () => {
  const games = [
    { at: day(0), scores: [['a', 50000], ['b', 30000], ['c', 15000], ['d', 5000]] },
    { season: 'fall', at: fallDay(0), scores: [['a', 60000], ['b', 25000], ['c', 10000], ['d', 5000]] },
    { season: 'casual', at: day(1), scores: [['a', 70000], ['b', 20000], ['c', 8000], ['d', 2000]] }
  ] satisfies GameSpec[];

  it('covers every season, Casual included, when no season is requested', () => {
    const data = derive(games);
    expect(data.isAllTime).toBe(true);
    expect(data.gameCount).toBe(3);
    expect(holders(data, 'highest-first').map(([, value]) => value)).toEqual([70000, 60000, 50000]);
  });

  it('limits every record to the requested season', () => {
    const data = derive(games, 'fall');
    expect(data.isAllTime).toBe(false);
    expect(data.gameCount).toBe(1);
    expect(holders(data, 'highest-first')).toEqual([['a', 60000]]);
  });

  it('returns null for an unknown season', () => {
    expect(deriveHallOfFame(snapshot(games), { seasonId: 'missing' })).toBeNull();
  });

  it('offers All time first, then competition seasons newest first, then Casual', () => {
    expect(derive(games).scopes.map((scope) => scope.label)).toEqual([
      'All time',
      'fall',
      'spring',
      'casual'
    ]);
  });

  it('names the season on all-time entries only', () => {
    expect(record(derive(games), 'highest-first')?.entries[0].detail).toContain('casual');
    expect(record(derive(games, 'fall'), 'highest-first')?.entries[0].detail).not.toContain('fall');
  });
});

describe('match records', () => {
  const games: GameSpec[] = [
    { at: day(0), scores: [['a', 91600], ['b', 13800], ['c', 6200], ['d', -11600]], sticks: 0 },
    { at: day(1), scores: [['a', 27700], ['b', 27300], ['c', 24200], ['d', 20800]], sticks: 0 },
    { at: day(2), scores: [['a', 86000], ['b', 48700], ['c', 600], ['d', -35300]], sticks: 0 },
    { at: day(3), scores: [['a', 36000], ['b', 35900], ['c', 26100], ['d', 0]], sticks: 2000 }
  ];

  it('finds the score extremes at each finishing place', () => {
    const data = derive(games);
    expect(holders(data, 'highest-first')[0]).toEqual(['a', 91600]);
    expect(holders(data, 'lowest-first')[0]).toEqual(['a', 27700]);
    expect(holders(data, 'highest-second')[0]).toEqual(['b', 48700]);
    expect(holders(data, 'lowest-second')[0]).toEqual(['b', 13800]);
    expect(holders(data, 'highest-third')[0]).toEqual(['c', 26100]);
    expect(holders(data, 'lowest-third')[0]).toEqual(['c', 600]);
    expect(holders(data, 'highest-fourth')[0]).toEqual(['d', 20800]);
    expect(holders(data, 'lowest-score')[0]).toEqual(['d', -35300]);
  });

  it('measures margins between finishing places', () => {
    const data = derive(games);
    expect(holders(data, 'photo-finish')[0]).toEqual(['a+b', 100]);
    expect(holders(data, 'runaway')[0]).toEqual(['a+b', 77800]);
    expect(holders(data, 'blowout')[0]).toEqual(['a+d', 121300]);
    expect(holders(data, 'tightest-table')[0]).toEqual(['a+d', 6900]);
    expect(holders(data, 'sticks')).toEqual([['', 2000]]);
  });

  it('shows the whole table and marks the record holder', () => {
    const entry = record(derive(games), 'lowest-score')?.entries[0];
    expect(entry?.href).toBe('/match/m002');
    expect(entry?.table?.map((seat) => [seat.player_id, seat.raw_points, seat.is_holder])).toEqual([
      ['a', 86000, false],
      ['b', 48700, false],
      ['c', 600, false],
      ['d', -35300, true]
    ]);
  });

  it('lets tied scores share a place, as the match page does', () => {
    const data = derive([
      { at: day(0), scores: [['a', 49900], ['b', 30900], ['c', 9600], ['d', 9600]] }
    ]);
    expect(holders(data, 'highest-fourth')).toEqual([]);
    expect(holders(data, 'lowest-third')).toEqual([
      ['c', 9600],
      ['d', 9600]
    ]);
    expect(record(data, 'lowest-third')?.entries.map((entry) => entry.rank)).toEqual([1, 1]);
  });

  it('calls a level first place a tie', () => {
    const entry = record(
      derive([{ at: day(0), scores: [['a', 40000], ['b', 40000], ['c', 15000], ['d', 5000]] }]),
      'photo-finish'
    )?.entries[0];
    expect(entry?.value).toBe(0);
    expect(entry?.joiner).toBe('tied with');
  });

  it('ranks ties together, with the earliest first, and counts the overflow', () => {
    const tied = (index: number): GameSpec => ({
      at: day(index),
      scores: [['a', 40000], ['b', 30000], ['c', 20000], ['d', 10000]]
    });
    const rec = record(derive([tied(4), tied(1), tied(3), tied(0), tied(2)]), 'highest-first');
    expect(rec?.entries.map((entry) => entry.rank)).toEqual([1, 1, 1]);
    expect(rec?.entries.map((entry) => entry.href)).toEqual([
      '/match/m003',
      '/match/m001',
      '/match/m004'
    ]);
    expect(rec?.moreTied).toBe(2);
  });

  it('credits a win from below the table average R as a giant killing', () => {
    const data = derive([
      ordered(day(0), 'bcad'),
      ordered(day(1), 'bcad'),
      ordered(day(2), 'bcad'),
      ordered(day(3), 'abcd')
    ]);
    const lead = record(data, 'giant-killer')?.entries[0];
    expect(lead?.players[0].player_id).toBe('a');
    expect(lead?.value).toBeGreaterThan(0);
    expect(lead?.href).toBe('/match/m003');
  });

  it('leaves rating records out of a season without ratings', () => {
    const data = derive([{ ...ordered(day(0), 'abcd'), season: 'casual' }], 'casual');
    expect(record(data, 'giant-killer')).toBeUndefined();
    expect(record(data, 'peak-rating')).toBeUndefined();
  });
});

describe('comebacks and collapses', () => {
  it('rewards climbing out of a real hole back above zero', () => {
    const data = derive([
      ordered(day(0), 'bcda'), // a: -45
      ordered(day(1), 'bcda'), // a: -90
      ordered(day(2), 'abcd'), // a: -45
      ordered(day(3), 'abcd'), // a: 0
      ordered(day(4), 'abcd') // a: +45
    ]);
    const lead = record(data, 'comeback')?.entries[0];
    expect(lead?.players[0].player_id).toBe('a');
    expect(lead?.value).toBeCloseTo(135);
    expect(lead?.detail).toContain('−90.0 → +45.0 in 3 games');
    expect(lead?.href).toBe('/player/a?season=spring');
  });

  it('ignores a shallow dip, however large the climb after it', () => {
    const data = derive([
      ordered(day(0), 'bacd'), // a: +15
      ordered(day(1), 'bcad'), // a: 0
      ordered(day(2), 'bcad'), // a: -15
      ordered(day(3), 'abcd'),
      ordered(day(4), 'abcd'),
      ordered(day(5), 'abcd')
    ]);
    expect(holders(data, 'comeback').map(([id]) => id)).not.toContain('a');
  });

  it('does not count a climb that never gets back above zero', () => {
    const data = derive([
      ordered(day(0), 'bcda'), // a: -45
      ordered(day(1), 'bcda'), // a: -90
      ordered(day(2), 'abcd') // a: -45
    ]);
    expect(holders(data, 'comeback').map(([id]) => id)).not.toContain('a');
  });

  it('keeps a comeback inside one season, since SP resets', () => {
    const data = derive([
      ordered(day(0), 'bcda'),
      ordered(day(1), 'bcda'),
      { ...ordered(fallDay(0), 'abcd'), season: 'fall' },
      { ...ordered(fallDay(1), 'abcd'), season: 'fall' },
      { ...ordered(fallDay(2), 'abcd'), season: 'fall' }
    ]);
    expect(holders(data, 'comeback').map(([id]) => id)).not.toContain('a');
  });

  it('finds a collapse as the mirror image of a comeback', () => {
    const data = derive([
      ordered(day(0), 'abcd'), // a: +45
      ordered(day(1), 'abcd'), // a: +90
      ordered(day(2), 'bcda'), // a: +45
      ordered(day(3), 'bcda'), // a: 0
      ordered(day(4), 'bcda') // a: -45
    ]);
    const lead = record(data, 'collapse')?.entries[0];
    expect(lead?.players[0].player_id).toBe('a');
    expect(lead?.value).toBeCloseTo(-135);
    expect(lead?.detail).toContain('+90.0 → −45.0 in 3 games');
  });
});

describe('sessions', () => {
  it('groups games by Arizona date and needs at least two of them', () => {
    const data = derive([
      // 18:00 and 20:00 on Feb 1 in Arizona, though the second is Feb 2 in UTC.
      ordered('2026-02-02T01:00:00Z', 'abcd'),
      ordered('2026-02-02T03:00:00Z', 'abcd'),
      // A single game on its own day is not a session, however good.
      { at: '2026-02-10T19:00:00Z', scores: [['b', 90000], ['a', 8000], ['c', 1000], ['d', 1000]] }
    ]);
    const lead = record(data, 'best-session')?.entries[0];
    expect(lead?.players[0].player_id).toBe('a');
    expect(lead?.value).toBeCloseTo(90);
    expect(lead?.detail).toContain('2 of 2 games won');
    expect(holders(data, 'best-session').map(([id]) => id)).not.toContain('c');
    expect(holders(data, 'worst-session')[0][0]).toBe('d');
  });
});

describe('streaks', () => {
  it('finds the longest run for each player', () => {
    const data = derive([
      ordered(day(0), 'abcd'),
      ordered(day(1), 'abcd'),
      ordered(day(2), 'bacd'),
      ordered(day(3), 'abcd'),
      ordered(day(4), 'abcd'),
      ordered(day(5), 'abcd')
    ]);
    expect(holders(data, 'win-streak')[0]).toEqual(['a', 3]);
    expect(holders(data, 'top-two-streak')[0]).toEqual(['a', 6]);
    expect(holders(data, 'last-streak')[0]).toEqual(['d', 6]);
    expect(holders(data, 'winless-streak')[0]).toEqual(['c', 6]);
  });

  it('carries across competition seasons in all time, but not within one season', () => {
    const games = [
      ordered(day(0), 'abcd'),
      ordered(day(1), 'abcd'),
      { ...ordered(fallDay(0), 'abcd'), season: 'fall' },
      { ...ordered(fallDay(1), 'abcd'), season: 'fall' }
    ];
    expect(holders(derive(games), 'win-streak')[0]).toEqual(['a', 4]);
    expect(holders(derive(games, 'spring'), 'win-streak')[0]).toEqual(['a', 2]);
    expect(record(derive(games), 'win-streak')?.entries[0].detail).toContain('spring → fall');
  });

  it('never lets a Casual game cut a season record out of all time', () => {
    const games = [
      ordered(day(0), 'abcd'),
      ordered(day(1), 'abcd'),
      { ...ordered(day(2), 'bcda'), season: 'casual' },
      ordered(day(3), 'abcd')
    ];
    expect(holders(derive(games, 'spring'), 'win-streak')[0]).toEqual(['a', 3]);
    expect(holders(derive(games), 'win-streak')[0]).toEqual(['a', 3]);
  });

  it('marks a run alive only when it reaches the active season’s latest game', () => {
    const alive = [
      { ...ordered(fallDay(0), 'abcd'), season: 'fall' },
      { ...ordered(fallDay(1), 'abcd'), season: 'fall' }
    ];
    expect(record(derive(alive), 'win-streak')?.entries[0].ongoing).toBe(true);

    const broken = [...alive, { ...ordered(fallDay(2), 'bacd'), season: 'fall' }];
    expect(record(derive(broken), 'win-streak')?.entries[0].ongoing).toBe(false);

    const finishedSeason = [ordered(day(0), 'abcd'), ordered(day(1), 'abcd')];
    expect(record(derive(finishedSeason), 'win-streak')?.entries[0].ongoing).toBe(false);
  });

  it('does not list a single game as a streak', () => {
    expect(record(derive([ordered(day(0), 'abcd')]), 'win-streak')).toBeUndefined();
  });
});

describe('playing style', () => {
  const games = Array.from({ length: 5 }, (_, index) => ordered(day(index), 'abcd'));

  it('needs the minimum games before a share counts', () => {
    expect(holders(derive(games.slice(0, 4)), 'win-rate')).toEqual([]);
    expect(holders(derive(games, 'spring'), 'win-rate')).toEqual([['a', 1]]);
    expect(holders(derive(games), 'win-rate')).toEqual([]);
  });

  it('counts busts and games played', () => {
    const data = derive([
      { at: day(0), scores: [['a', 60000], ['b', 30000], ['c', 15000], ['d', -5000]] },
      { at: day(1), scores: [['a', 60000], ['b', 30000], ['c', 15000], ['d', -5000]] },
      { at: day(2), scores: [['e', 60000], ['b', 30000], ['c', 15000], ['a', -5000]] }
    ]);
    expect(holders(data, 'busts')[0]).toEqual(['d', 2]);
    expect(holders(data, 'most-games').slice(0, 3).map(([, value]) => value)).toEqual([3, 3, 3]);
  });

  it('separates volatile players from steady ones', () => {
    const swings = Array.from({ length: 6 }, (_, index) => ({
      at: day(index),
      scores:
        index % 2 === 0
          ? [['a', 70000], ['b', 26000], ['c', 24000], ['d', -20000]]
          : [['d', 70000], ['b', 26000], ['c', 24000], ['a', -20000]]
    })) as GameSpec[];
    const data = derive(swings, 'spring');
    expect(String(holders(data, 'rollercoaster')[0][0])).toMatch(/^[ad]$/);
    expect(String(holders(data, 'iron-wall')[0][0])).toMatch(/^[bc]$/);
  });
});

describe('rivalries', () => {
  it('needs enough meetings, then finds the most-met pair and the most lopsided one', () => {
    const games = [
      ordered(day(0), 'abcd'),
      ordered(day(1), 'abcd'),
      ordered(day(2), 'abcd'),
      ordered(day(3), 'bacd')
    ];
    const data = derive(games, 'spring');
    const nemesis = record(data, 'nemesis')?.entries[0];
    expect(nemesis?.valueText).toBe('4–0');
    expect(nemesis?.joiner).toBe('over');

    const rivalry = record(data, 'rivalry')?.entries[0];
    expect(rivalry?.value).toBe(4);
    expect(rivalry?.players.map((holder) => holder.player_id)).toEqual(['a', 'b']);
    expect(rivalry?.detail).toBe('A leads 3–1');

    expect(record(derive(games.slice(0, 3), 'spring'), 'rivalry')).toBeUndefined();
  });
});

describe('podiums', () => {
  const tenGames = Array.from({ length: 5 }, (_, index) => ordered(day(index), 'abcd'));

  it('lists each competition season in all time and leaves Casual out', () => {
    const data = derive([
      ...tenGames,
      ...tenGames.map((game, index) => ({ ...game, at: fallDay(index), season: 'fall' })),
      ...tenGames.map((game, index) => ({ ...game, at: fallDay(10 + index), season: 'casual' }))
    ]);
    expect(data.podiums.map((podium) => podium.season.id)).toEqual(['fall', 'spring']);
    expect(data.podiums[0].rows.map((row) => [row.rank, row.player_id])).toEqual([
      [1, 'a'],
      [2, 'b'],
      [3, 'c']
    ]);
  });

  it('applies the five-game eligibility rule to competition seasons only', () => {
    const short = tenGames.slice(0, 4);
    expect(derive(short, 'spring').podiums).toEqual([]);
    const casual = short.map((game) => ({ ...game, season: 'casual' }));
    expect(derive(casual, 'casual').podiums[0].rows[0].player_id).toBe('a');
  });

  it('adds season-total records to all time only', () => {
    expect(holders(derive(tenGames), 'best-season')[0][0]).toBe('a');
    expect(holders(derive(tenGames), 'worst-season')[0][0]).toBe('d');
    expect(record(derive(tenGames, 'spring'), 'best-season')).toBeUndefined();
  });
});

describe('an empty season', () => {
  it('has no records or podium', () => {
    const data = derive([ordered(day(0), 'abcd')], 'fall');
    expect(data.gameCount).toBe(0);
    expect(data.podiums).toEqual([]);
    expect(data.matchGroups).toEqual([]);
    expect(data.playerGroups).toEqual([]);
  });
});
