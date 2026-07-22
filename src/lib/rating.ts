export function ratingGamesAdjustment(gamesPlayed: number): number {
  if (!Number.isFinite(gamesPlayed)) return 1;
  if (gamesPlayed <= 20) return Math.max(1 - 0.04 * gamesPlayed, 0.2);
  return 0.2;
}
