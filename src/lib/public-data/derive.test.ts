import { describe, expect, it } from 'vitest';
import {
  LIFETIME_SEASON_ID,
  deriveLifetimeRatings,
  deriveMatchPage,
  derivePlayerPage,
  derivePublicData,
  deriveSeasonMatchesPage,
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

  it('lists every season match newest first while the season page keeps the latest ten', () => {
    const snapshot = fixture();
    for (let day = 3; day <= 14; day += 1) {
      const id = `extra-${day}`;
      snapshot.matches.push(
        match(id, 'spring', `2026-02-${String(day).padStart(2, '0')}T12:00:00Z`)
      );
      snapshot.match_results.push(...results(id, ['p1', 'p2', 'p3', 'p4']));
    }

    const page = deriveSeasonMatchesPage(snapshot, 'spring');
    expect(page!.matches).toHaveLength(14);
    expect(page!.matches[0]).toMatchObject({
      id: 'extra-14',
      winner_player_id: 'p1',
      top_raw_points: 40000,
      sp_spread: 90
    });
    expect(page!.matches[13].id).toBe('m1');

    const seasonPage = deriveSeasonPage(snapshot, 'spring');
    expect(seasonPage!.recentMatches.map((row) => row.id)).toEqual(
      page!.matches.slice(0, 10).map((row) => row.id)
    );
    expect(seasonPage!.matchCount).toBe(14);
  });

  it('filters the match list to a casual event and ignores events on other seasons', () => {
    const snapshot = fixture();
    snapshot.matches.push(
      match('m4', 'casual', '2026-02-04T12:00:00Z', { include_in_lifetime_rating: false })
    );
    snapshot.match_results.push(...results('m4', ['p1', 'p2', 'p3', 'p4']));

    const ids = (seasonId: string, eventId?: string) =>
      deriveSeasonMatchesPage(snapshot, seasonId, { eventId })!.matches.map((row) => row.id);

    expect(ids('casual')).toEqual(['m4', 'm3']);
    expect(ids('casual', 'event-1')).toEqual(['m3']);
    expect(deriveSeasonPage(snapshot, 'casual', { eventId: 'event-1' })!.matchCount).toBe(1);
    expect(ids('spring', 'event-1')).toEqual(['m2', 'm1']);
    expect(deriveSeasonMatchesPage(snapshot, 'spring', { eventId: 'event-1' })!.eventId).toBeNull();
  });

  it('finds no match list for an unknown season', () => {
    expect(deriveSeasonMatchesPage(fixture(), 'missing')).toBeNull();
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

  it('reports each rank change on match ratings', () => {
    const snapshot = fixture();
    const ratings = deriveLifetimeRatings(snapshot);
    const first = deriveMatchPage(snapshot, 'm1')!;
    const latest = deriveMatchPage(snapshot, 'm2')!;

    for (const row of first.ratingDeltas) {
      expect(row.rank_before).toBeNull();
    }
    for (const row of latest.ratingDeltas) {
      const previous = first.ratingDeltas.find((other) => other.player_id === row.player_id);
      expect(row.rank_before).toBe(previous?.rank_after ?? null);
      expect(row.rank_after).toBe(ratings.stateByPlayerId.get(row.player_id)?.rank);
    }

    const oldRates = latest.ratingDeltas.map((row) => row.old_rate);
    expect(latest.ratingTableAverage).toBeCloseTo(
      oldRates.reduce((total, rate) => total + rate, 0) / oldRates.length
    );
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
    expect(page!.placementHistory[0]).toMatchObject({ raw_points: 40000, club_points: 45 });
    expect(page!.pointHistory[1]).toMatchObject({ raw_points: 30000, placement: 2 });
    expect(page!.ratingHistory).toHaveLength(2);
    expect(page!.matchHistory.map((row) => row.match_id)).toEqual(['m2', 'm1']);
    expect(page!.bestRawMatch).toEqual({
      match_id: 'm1',
      played_at: '2026-02-01T12:00:00Z',
      raw_points: 40000
    });
    expect(page!.worstRawMatch?.raw_points).toBe(30000);
  });

  it('runs the competition history across seasons and leaves Casual out', () => {
    const snapshot = fixture();
    snapshot.seasons.push({
      id: 'fall',
      name: 'Fall 2026 League',
      start_date: '2026-09-01',
      end_date: '2026-12-31',
      is_active: false,
      is_casual: false
    });
    snapshot.matches.push(match('m4', 'fall', '2026-09-02T12:00:00Z'));
    snapshot.match_results.push(...results('m4', ['p1', 'p2', 'p3', 'p4']));

    const { competitionHistory, pointHistory } = derivePlayerPage(snapshot, 'p1', {
      seasonId: 'fall'
    })!;

    expect(pointHistory.map((row) => row.match_id)).toEqual(['m4']);
    expect(competitionHistory.pointHistory.map((row) => row.match_id)).toEqual(['m1', 'm2', 'm4']);
    expect(competitionHistory.pointHistory.map((row) => row.cumulative_points)).toEqual([45, 60, 105]);
    expect(competitionHistory.placementHistory.map((row) => row.placement)).toEqual([1, 2, 1]);
    expect(competitionHistory.ratingHistory.map((row) => row.match_id)).toEqual(['m1', 'm2', 'm4']);
    expect(competitionHistory.matchHistory.map((row) => row.match_id)).toEqual(['m4', 'm2', 'm1']);
  });

  describe('lifetime player view', () => {
    function withFinishedSeason() {
      const snapshot = fixture();
      snapshot.seasons.push({
        id: 'fall',
        name: 'Fall 2025',
        start_date: '2025-09-01',
        end_date: '2025-12-31',
        is_active: false,
        is_casual: false
      });
      // p1 wins all five games of a finished season, then three more in the active one.
      for (let game = 1; game <= 5; game += 1) {
        snapshot.matches.push(match(`f${game}`, 'fall', `2025-10-0${game}T12:00:00Z`));
        snapshot.match_results.push(...results(`f${game}`, ['p1', 'p2', 'p3', 'p4']));
      }
      for (let game = 3; game <= 5; game += 1) {
        snapshot.matches.push(match(`s${game}`, 'spring', `2026-03-0${game}T12:00:00Z`));
        snapshot.match_results.push(...results(`s${game}`, ['p1', 'p2', 'p3', 'p4']));
      }
      return snapshot;
    }

    it('covers every competition season and leaves Casual out', () => {
      const page = derivePlayerPage(withFinishedSeason(), 'p1', { seasonId: LIFETIME_SEASON_ID })!;

      expect(page.isLifetime).toBe(true);
      expect(page.seasonId).toBe(LIFETIME_SEASON_ID);
      expect(page.isCasualSeason).toBe(false);
      expect(page.stats!.games_played).toBe(10);
      expect(page.matchHistory.map((row) => row.match_id)).not.toContain('m3');
      expect(page.pointHistory).toHaveLength(10);
      expect(page.bestRawMatch!.raw_points).toBe(40000);
    });

    it('summarizes each season, newest first, with its adjusted SP and rank', () => {
      const { lifetime } = derivePlayerPage(withFinishedSeason(), 'p1', { seasonId: LIFETIME_SEASON_ID })!;

      expect(lifetime!.seasons.map((row) => [row.season_id, row.rank, row.games_played, row.total_points])).toEqual([
        ['spring', 1, 5, 200],
        ['fall', 1, 5, 225]
      ]);
      expect(lifetime!.total_points).toBe(425);
      expect(lifetime!.best_rank).toBe(1);
      expect(lifetime!.peak_rating).toBeGreaterThan(1500);
    });

    it('counts a title only for a finished season', () => {
      const { lifetime } = derivePlayerPage(withFinishedSeason(), 'p1', { seasonId: LIFETIME_SEASON_ID })!;
      expect(lifetime!.seasons[0].is_active).toBe(true);
      expect(lifetime!.titles).toBe(1);
    });

    it('leaves a season unranked below the game minimum', () => {
      const { lifetime } = derivePlayerPage(fixture(), 'p1', { seasonId: LIFETIME_SEASON_ID })!;
      expect(lifetime!.seasons.map((row) => row.rank)).toEqual([null]);
      expect(lifetime!.best_rank).toBeNull();
      expect(lifetime!.titles).toBe(0);
    });

    it('counts busts and has no rating for a player without ranked games', () => {
      const snapshot = fixture();
      snapshot.seasons.push({
        id: 'trial',
        name: 'Trial',
        start_date: '2025-09-01',
        end_date: '2025-12-31',
        is_active: false,
        is_casual: false
      });
      snapshot.players.push({ ...players[3], id: 'p5', display_name: 'Echo' });
      snapshot.matches.push(match('t1', 'trial', '2025-10-01T12:00:00Z'));
      snapshot.match_results.push(
        ...results('t1', ['p1', 'p2', 'p3', 'p5'], [70000, 20000, 15000, -5000])
      );

      const { lifetime, stats } = derivePlayerPage(snapshot, 'p5', { seasonId: LIFETIME_SEASON_ID })!;
      expect(stats!.games_played).toBe(1);
      expect(lifetime!.busts).toBe(1);
      expect(lifetime!.peak_rating).toBeNull();
    });

    it('is off for an ordinary season', () => {
      const page = derivePlayerPage(fixture(), 'p1', { seasonId: 'spring' })!;
      expect(page.isLifetime).toBe(false);
      expect(page.lifetime).toBeNull();
    });
  });

  it('keeps the competition history when Casual is the selected season', () => {
    const page = derivePlayerPage(fixture(), 'p1', { seasonId: 'casual' })!;
    expect(page.placementHistory.map((row) => row.match_id)).toEqual(['m3']);
    expect(page.competitionHistory.placementHistory.map((row) => row.match_id)).toEqual(['m1', 'm2']);
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

  it('keeps cached standings independent of callers, seasons, events, and refreshed snapshots', () => {
    const snapshot = fixture();
    const first = deriveStandings(snapshot, 'spring');
    first[0].total_points = 999;
    first.reverse();
    expect(deriveStandings(snapshot, 'spring')[0]).toMatchObject({
      player_id: 'p1', total_points: 60
    });
    const playerPage = derivePlayerPage(snapshot, 'p1', { seasonId: 'spring' })!;
    playerPage.standingsRow!.rank = 999;
    expect(deriveStandings(snapshot, 'spring')[0].rank).toBe(1);
    expect(deriveStandings(snapshot, 'casual', 'missing')).toEqual([]);
    expect(deriveStandings(snapshot, 'casual', 'event-1')[0].total_points).toBe(45);
    expect(derivePlayerPage(snapshot, 'p1', { seasonId: 'missing' })!.stats).toBeNull();

    const refreshed = fixture();
    refreshed.revision.revision = '8';
    refreshed.adjustments[0].points = -10;
    expect(deriveStandings(refreshed, 'spring')[0].player_id).toBe('p2');
    expect(deriveStandings(snapshot, 'spring')[0].player_id).toBe('p1');
  });

  it('preserves newest-match tie breaks for point and raw extremes and histories', () => {
    const snapshot = fixture();
    snapshot.matches = [
      match('latest-a', 'casual', '2026-02-03T12:00:00Z'),
      match('older', 'casual', '2026-02-01T12:00:00Z'),
      match('latest-z', 'casual', '2026-02-03T12:00:00Z')
    ];
    snapshot.match_results = snapshot.matches.flatMap((row) =>
      results(row.id, ['p1', 'p2', 'p3', 'p4'])
    );

    const page = derivePlayerPage(snapshot, 'p1', { seasonId: 'casual' })!;
    expect(page.stats).toMatchObject({
      best_match_id: 'latest-z', worst_match_id: 'latest-z',
      last_played_at: '2026-02-03T12:00:00Z',
      firsts: 3, seconds: 0, thirds: 0, fourths: 0,
      median_points: 45, stdev_points: 0
    });
    expect(page.bestRawMatch!.match_id).toBe('latest-z');
    expect(page.worstRawMatch!.match_id).toBe('latest-z');
    expect(page.matchHistory.map((row) => row.match_id)).toEqual(['latest-z', 'latest-a', 'older']);
    expect(page.pointHistory.map((row) => row.match_id)).toEqual(['older', 'latest-a', 'latest-z']);
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
      matches: [...casualMatches].reverse(),
      match_results: casualMatches.flatMap((row) =>
        results(row.id, ['p1', 'p2', 'p3', 'p4'])
      ),
      adjustments: []
    };

    const page = derivePlayerPage(snapshot, 'p1', { seasonId: 'casual' });

    expect(page!.pointHistory).toHaveLength(200);
    expect(page!.pointHistory[0].cumulative_points).toBe(90);
    expect(page!.pointHistory.at(-1)?.cumulative_points).toBe(201 * 45);
    expect(page!.matchHistory).toHaveLength(100);
    expect(page!.matchHistory[0].match_id).toBe('long-200');
    expect(page!.placementHistory).toHaveLength(200);
    expect(page!.placementHistory[0].match_id).toBe('long-001');
    expect(page!.placementHistory.at(-1)?.match_id).toBe('long-200');
  });

  it('includes older event adjustments in capped cumulative histories without leaking other adjustments', () => {
    const snapshot = fixture();
    snapshot.matches = Array.from({ length: 201 }, (_, index) =>
      match(`event-${index}`, 'casual', new Date(Date.UTC(2026, 0, index + 1)).toISOString(), {
        casual_event_id: 'event-1'
      })
    );
    snapshot.match_results = snapshot.matches.flatMap((row) =>
      results(row.id, ['p1', 'p2', 'p3', 'p4'])
    );
    snapshot.adjustments = [
      { ...snapshot.adjustments[1], match_id: 'event-0', player_id: 'p1', points: 7 },
      { ...snapshot.adjustments[1], id: 'other-player', match_id: 'event-0', player_id: 'p2', points: 50 },
      { ...snapshot.adjustments[1], id: 'other-match', match_id: 'missing', player_id: 'p1', points: 50 }
    ];
    const page = derivePlayerPage(snapshot, 'p1', { seasonId: 'casual', eventId: 'event-1' })!;
    expect(page.pointHistory).toHaveLength(200);
    expect(page.pointHistory[0].cumulative_points).toBe(97);
    expect(page.pointHistory.at(-1)?.cumulative_points).toBe(201 * 45 + 7);
    expect(page.standingsRow!.adjustment_points).toBe(7);
  });
});
