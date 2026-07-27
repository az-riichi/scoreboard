import { describe, expect, it } from 'vitest';
import {
  deriveLifetimeRatings,
  deriveMatchPage,
  derivePlayerPage,
  derivePublicData,
  deriveSeasonPage,
  deriveStandings
} from './derive';
import { scoreMatchResults } from './scoring';
import type {
  PublicDataSnapshot,
  PublicFinalMatch,
  RawMatchResult,
  RedactedPublicPlayer
} from './types';

const players: RedactedPublicPlayer[] = [
  {
    id: 'p1',
    display_name: 'Ace',
    real_first_name: 'Alice',
    real_last_name: 'A',
    show_display_name: true,
    show_real_first_name: true,
    show_real_last_name: true,
    profile_message_md: '**Hello**',
    profile_media_url: null,
    is_active: true
  },
  {
    id: 'p2',
    display_name: 'Bravo',
    real_first_name: null,
    real_last_name: null,
    show_display_name: true,
    show_real_first_name: false,
    show_real_last_name: false,
    profile_message_md: null,
    profile_media_url: null,
    is_active: true
  },
  {
    id: 'p3',
    display_name: 'Charlie',
    real_first_name: null,
    real_last_name: null,
    show_display_name: true,
    show_real_first_name: false,
    show_real_last_name: false,
    profile_message_md: null,
    profile_media_url: null,
    is_active: true
  },
  {
    id: 'p4',
    display_name: 'Delta',
    real_first_name: null,
    real_last_name: null,
    show_display_name: true,
    show_real_first_name: false,
    show_real_last_name: false,
    profile_message_md: null,
    profile_media_url: null,
    is_active: true
  }
];

const ruleset = {
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
};

function match(
  id: string,
  seasonId: string,
  playedAt: string,
  extra: Partial<PublicFinalMatch> = {}
): PublicFinalMatch {
  return {
    id,
    season_id: seasonId,
    casual_event_id: null,
    ruleset_id: ruleset.id,
    game_number: 1,
    table_mode: 'A',
    extra_sticks: 0,
    include_in_lifetime_rating: true,
    played_at: playedAt,
    status: 'final',
    table_label: id.toUpperCase(),
    notes: null,
    ...extra
  };
}

function results(
  matchId: string,
  orderedPlayerIds: readonly string[],
  rawPoints: readonly number[] = [40000, 30000, 20000, 10000]
): RawMatchResult[] {
  const seats = ['E', 'S', 'W', 'N'] as const;
  return seats.map((seat, index) => ({
    match_id: matchId,
    seat,
    player_id: orderedPlayerIds[index],
    raw_points: rawPoints[index]
  }));
}

function fixture(): PublicDataSnapshot {
  const matches = [
    match('m1', 'spring', '2026-02-01T12:00:00Z'),
    match('m2', 'spring', '2026-02-02T12:00:00Z'),
    match('m3', 'casual', '2026-02-03T12:00:00Z', {
      casual_event_id: 'event-1',
      include_in_lifetime_rating: false
    })
  ];

  return {
    schema_version: 1,
    revision: {
      scope: 'scoreboard',
      revision: '7',
      changed_at: '2026-02-03T13:00:00Z'
    },
    seasons: [
      {
        id: 'spring',
        name: 'Spring 2026 League',
        start_date: '2026-01-01',
        end_date: '2026-05-31',
        is_active: true,
        is_casual: false
      },
      {
        id: 'casual',
        name: 'Casual',
        start_date: null,
        end_date: null,
        is_active: false,
        is_casual: true
      }
    ],
    casual_events: [{ id: 'event-1', name: 'Friday' }],
    players,
    rulesets: [ruleset],
    matches,
    match_results: [
      ...results('m1', ['p1', 'p2', 'p3', 'p4']),
      ...results('m2', ['p2', 'p1', 'p4', 'p3']),
      ...results('m3', ['p3', 'p1', 'p2', 'p4'])
    ],
    adjustments: [
      {
        id: 'a1',
        season_id: 'spring',
        match_id: null,
        player_id: 'p1',
        points: 5,
        created_at: '2026-02-02T13:00:00Z'
      },
      {
        id: 'a2',
        season_id: 'casual',
        match_id: 'm3',
        player_id: 'p3',
        points: -10,
        created_at: '2026-02-03T13:00:00Z'
      }
    ]
  };
}

describe('public scoreboard scoring', () => {
  it('uses seat order for placement while splitting UMA over a tied rank span', () => {
    const tiedMatch = match('tie', 'spring', '2026-02-01T12:00:00Z');
    const raw = results(
      tiedMatch.id,
      ['p1', 'p2', 'p3', 'p4'],
      [40000, 30000, 30000, 0]
    );
    const scored = scoreMatchResults(
      tiedMatch,
      raw,
      ruleset,
      new Map(players.map((player) => [player.id, player]))
    );

    expect(raw[0]).not.toHaveProperty('placement');
    expect(raw[0]).not.toHaveProperty('club_points');
    expect(scored.map((row) => [row.seat, row.placement, row.club_points])).toEqual([
      ['E', 1, 45],
      ['S', 2, 5],
      ['W', 3, 5],
      ['N', 4, -55]
    ]);
  });

  it('rejects incomplete final matches instead of caching partial analytics', () => {
    expect(() =>
      scoreMatchResults(
        match('broken', 'spring', '2026-02-01T12:00:00Z'),
        results('broken', ['p1', 'p2', 'p3', 'p4']).slice(0, 3),
        ruleset,
        new Map(players.map((player) => [player.id, player]))
      )
    ).toThrow('exactly four raw results');
  });
});

describe('public page derivations', () => {
  it('memoizes the scored ledger by snapshot identity', () => {
    const snapshot = fixture();
    const first = derivePublicData(snapshot);
    const second = derivePublicData(snapshot);

    expect(second).toBe(first);
    expect(deriveLifetimeRatings(snapshot)).toBe(first.lifetimeRatings);
  });

  it('derives adjusted dense standings, public names, and recent summaries', () => {
    const page = deriveSeasonPage(fixture(), 'spring');

    expect(page).not.toBeNull();
    expect(
      page!.standings.map((row) => [
        row.player_id,
        row.rank,
        row.total_points_with_adjustments
      ])
    ).toEqual([
      ['p1', 1, 65],
      ['p2', 2, 60],
      ['p3', 3, -60],
      ['p4', 3, -60]
    ]);
    expect(page!.standings[0]).toMatchObject({
      player_name_primary: 'Alice A',
      player_name_secondary: 'Ace',
      games_played: 2,
      avg_placement: 1.5,
      top2_rate: 1
    });
    expect(page!.recentMatches[0]).toMatchObject({
      id: 'm2',
      winner_player_id: 'p2',
      winner_name_primary: 'Bravo',
      top_raw_points: 40000,
      sp_spread: 90
    });
  });

  it('replays lifetime rating state and exposes the same deltas on match pages', () => {
    const snapshot = fixture();
    const ratings = deriveLifetimeRatings(snapshot);
    const p1 = ratings.stateByPlayerId.get('p1');
    const p2 = ratings.stateByPlayerId.get('p2');
    const matchPage = deriveMatchPage(snapshot, 'm2');

    expect(p1).toMatchObject({ games_played: 2, rank: 1 });
    expect(p1!.rate).toBeCloseTo(1538.88);
    expect(p2).toMatchObject({ games_played: 2, rank: 2 });
    expect(p2!.rate).toBeCloseTo(1538.56);
    expect(matchPage!.ratingDeltas).toHaveLength(4);
    expect(
      matchPage!.ratingDeltas.find((row) => row.player_id === 'p1')
    ).toMatchObject({
      placement: 2,
      old_rate: 1530,
      games_played_before: 1,
      player_name_primary: 'Alice A',
      player_name_secondary: 'Ace'
    });
  });

  it('builds player stats and chronological SP, placement, and rating histories', () => {
    const page = derivePlayerPage(fixture(), 'p1', { seasonId: 'spring' });

    expect(page).not.toBeNull();
    expect(page!.stats).toMatchObject({
      games_played: 2,
      total_points: 60,
      avg_placement: 1.5,
      firsts: 1,
      seconds: 1
    });
    expect(page!.standingsRow?.total_points_with_adjustments).toBe(65);
    expect(page!.seasonEligibleRank).toBeNull();
    expect(page!.pointHistory.map((row) => row.cumulative_points)).toEqual([45, 60]);
    expect(page!.placementHistory.map((row) => row.placement)).toEqual([1, 2]);
    expect(page!.ratingHistory).toHaveLength(2);
    expect(page!.matchHistory.map((row) => row.match_id)).toEqual(['m2', 'm1']);
    expect(page!.bestRawMatch).toEqual({
      match_id: 'm1',
      played_at: '2026-02-01T12:00:00Z',
      raw_points: 40000
    });
    expect(page!.worstRawMatch?.raw_points).toBe(30000);
  });

  it('applies match adjustments only to a selected casual event history', () => {
    const page = derivePlayerPage(fixture(), 'p3', {
      seasonId: 'casual',
      eventId: 'event-1'
    });
    const standings = deriveStandings(fixture(), 'casual', 'event-1');

    expect(page!.pointHistory[0]).toMatchObject({
      club_points: 45,
      adjustment_points: -10,
      points_with_adjustments: 35,
      cumulative_points: 35
    });
    expect(standings[0]).toMatchObject({
      player_id: 'p3',
      adjustment_points: -10,
      total_points_with_adjustments: 35
    });
    expect(page!.ratingHistory).toEqual([]);
  });

  it('keeps full-ledger cumulative SP when only the newest 200 rows are returned', () => {
    const base = fixture();
    const casualMatches = Array.from({ length: 201 }, (_, index) =>
      match(
        `long-${String(index).padStart(3, '0')}`,
        'casual',
        new Date(Date.UTC(2026, 0, 1 + index)).toISOString(),
        { include_in_lifetime_rating: false }
      )
    );
    const snapshot: PublicDataSnapshot = {
      ...base,
      matches: casualMatches,
      match_results: casualMatches.flatMap((row) =>
        results(row.id, ['p1', 'p2', 'p3', 'p4'])
      ),
      adjustments: []
    };

    const page = derivePlayerPage(snapshot, 'p1', { seasonId: 'casual' });

    expect(page!.pointHistory).toHaveLength(200);
    expect(page!.pointHistory[0].cumulative_points).toBe(90);
    expect(page!.pointHistory.at(-1)?.cumulative_points).toBe(201 * 45);
  });
});
