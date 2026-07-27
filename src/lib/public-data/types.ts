import type { PlayerProfileMedia } from '../player-profile-content';

export type Seat = 'E' | 'S' | 'W' | 'N';
export type MatchStatus = 'draft' | 'final' | 'void';

export type PublicDataRevision = {
  scope: string;
  revision: string;
  changed_at: string;
};

export type PublicSeason = {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
  is_casual: boolean;
};

export type PublicCasualEvent = {
  id: string;
  name: string;
};

/**
 * Names in this record have already been redacted by v_public_players.
 * A hidden name component is null, not merely hidden by presentation code.
 */
export type RedactedPublicPlayer = {
  id: string;
  display_name: string | null;
  real_first_name: string | null;
  real_last_name: string | null;
  show_display_name: boolean;
  show_real_first_name: boolean;
  show_real_last_name: boolean;
  profile_message_md: string | null;
  profile_media_url: string | null;
  is_active: boolean;
};

export type PublicRuleset = {
  id: string;
  name: string;
  start_points: number;
  return_points: number;
  point_divisor: number;
  uma_1: number;
  uma_2: number;
  uma_3: number;
  uma_4: number;
  oka_1: number;
  oka_2: number;
  oka_3: number;
  oka_4: number;
};

export type PublicFinalMatch = {
  id: string;
  season_id: string;
  casual_event_id: string | null;
  ruleset_id: string;
  game_number: number | null;
  table_mode: string | null;
  extra_sticks: number;
  include_in_lifetime_rating: boolean;
  played_at: string;
  status: MatchStatus;
  table_label: string | null;
  notes: string | null;
};

/**
 * Deliberately contains no placement, club_points, or tobi fields. Those
 * values are derived from the ruleset in the browser.
 */
export type RawMatchResult = {
  match_id: string;
  seat: Seat;
  player_id: string;
  raw_points: number;
};

export type PublicAdjustment = {
  id: string;
  season_id: string;
  match_id: string | null;
  player_id: string;
  points: number;
  created_at: string;
};

export type PublicDataSnapshot = {
  schema_version: number;
  revision: PublicDataRevision;
  seasons: PublicSeason[];
  casual_events: PublicCasualEvent[];
  players: RedactedPublicPlayer[];
  rulesets: PublicRuleset[];
  matches: PublicFinalMatch[];
  match_results: RawMatchResult[];
  adjustments: PublicAdjustment[];
};

export type DerivedFinalResult = {
  match_id: string;
  season_id: string;
  ruleset_id: string;
  game_number: number | null;
  table_mode: string | null;
  extra_sticks: number;
  played_at: string;
  table_label: string | null;
  seat: Seat;
  player_id: string;
  display_name: string;
  raw_points: number;
  club_points: number;
  placement: number;
  tobi: boolean;
  casual_event_id: string | null;
  casual_event_name: string | null;
};

export type PlayerNameParts = {
  player_name_primary: string;
  player_name_secondary: string | null;
};

export type StandingsRow = PlayerNameParts & {
  season_id: string;
  casual_event_id?: string;
  casual_event_name?: string | null;
  player_id: string;
  display_name: string;
  games_played: number;
  total_points: number;
  avg_placement: number;
  avg_points: number;
  firsts: number;
  seconds: number;
  thirds: number;
  fourths: number;
  top2_rate: number;
  fourth_rate: number;
  tobi_rate: number;
  adjustment_points: number;
  total_points_with_adjustments: number;
  rank: number;
  rating: number | null;
};

export type PlayerStats = {
  season_id: string;
  casual_event_id?: string;
  casual_event_name?: string | null;
  player_id: string;
  display_name: string;
  games_played: number;
  total_points: number;
  avg_placement: number;
  avg_points: number;
  firsts: number;
  seconds: number;
  thirds: number;
  fourths: number;
  top2_rate: number;
  first_rate: number;
  fourth_rate: number;
  stdev_points: number;
  median_points: number;
  best_points: number;
  worst_points: number;
  last_played_at: string;
  best_match_id: string;
  best_played_at: string;
  worst_match_id: string;
  worst_played_at: string;
};

export type RatingHistoryRow = PlayerNameParts & {
  is_lifetime: true;
  season_id: null;
  player_id: string;
  display_name: string;
  played_at: string;
  match_id: string;
  placement: number;
  old_rate: number;
  delta: number;
  new_rate: number;
  games_played_before: number;
  match_label: string;
};

export type LifetimeRatingState = {
  is_lifetime: true;
  season_id: null;
  player_id: string;
  display_name: string;
  rate: number;
  games_played: number;
  updated_at: string | null;
  rank: number;
};

export type LifetimeRatings = {
  history: RatingHistoryRow[];
  state: LifetimeRatingState[];
  stateByPlayerId: ReadonlyMap<string, LifetimeRatingState>;
  historyByMatchId: ReadonlyMap<string, RatingHistoryRow[]>;
  historyByPlayerId: ReadonlyMap<string, RatingHistoryRow[]>;
};

export type RecentMatchSummary = PublicFinalMatch & {
  winner_name_primary: string | null;
  winner_name_secondary: string | null;
  winner_name: string | null;
  winner_player_id: string | null;
  top_raw_points: number | null;
  sp_spread: number | null;
};

export type PlayerMatchHistoryRow = DerivedFinalResult & {
  match_label: string;
};

export type PlayerPointHistoryRow = {
  season_id: string;
  casual_event_id?: string;
  casual_event_name?: string | null;
  player_id: string;
  display_name: string;
  played_at: string;
  match_id: string;
  match_label: string;
  club_points: number;
  adjustment_points?: number;
  points_with_adjustments?: number;
  cumulative_points: number;
};

export type PlayerPlacementHistoryRow = {
  season_id: string;
  player_id: string;
  display_name: string;
  played_at: string;
  match_id: string;
  match_label: string;
  placement: number;
  casual_event_id: string | null;
  casual_event_name: string | null;
};

export type RawMatchExtreme = {
  match_id: string;
  played_at: string;
  raw_points: number;
};

export type SeasonsPageData = {
  seasons: PublicSeason[];
};

export type SeasonPageData = {
  season: PublicSeason;
  isCasual: boolean;
  isRatingSeason: boolean;
  events: PublicCasualEvent[];
  eventId: string | null;
  competitiveSeason: PublicSeason | null;
  casualSeason: PublicSeason | null;
  standings: StandingsRow[];
  recentMatches: RecentMatchSummary[];
};

export type MatchPageResult = DerivedFinalResult & PlayerNameParts;

export type MatchPageData = {
  match: PublicFinalMatch;
  season: PublicSeason | null;
  casualEvent: PublicCasualEvent | null;
  isCasual: boolean;
  results: MatchPageResult[];
  ratingDeltas: RatingHistoryRow[];
};

export type PlayerPageData = {
  player: RedactedPublicPlayer & PlayerNameParts;
  profileMessageHtml: string | null;
  profileMedia: PlayerProfileMedia;
  canEditDisplay: false;
  seasons: PublicSeason[];
  seasonId: string | null;
  isCasualSeason: boolean;
  events: PublicCasualEvent[];
  eventId: string | null;
  currentRating: {
    rate: number;
    games_played: number;
    updated_at: string | null;
  };
  currentRatingRank: number | null;
  currentRatingRankTotal: number;
  stats: PlayerStats | null;
  standingsRow: StandingsRow | null;
  seasonEligibleRank: number | null;
  matchHistory: PlayerMatchHistoryRow[];
  pointHistory: PlayerPointHistoryRow[];
  placementHistory: PlayerPlacementHistoryRow[];
  ratingHistory: RatingHistoryRow[];
  bestRawMatch: RawMatchExtreme | null;
  worstRawMatch: RawMatchExtreme | null;
};
