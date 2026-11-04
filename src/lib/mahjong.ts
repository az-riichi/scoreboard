export type Seat = 'E' | 'S' | 'W' | 'N';

export const WIND_KANJI: Record<Seat, string> = { E: '東', S: '南', W: '西', N: '北' };
export const WIND_NAMES: Record<Seat, string> = { E: 'East', S: 'South', W: 'West', N: 'North' };

export function windKanji(seat: unknown) {
  return WIND_KANJI[seat as Seat] ?? String(seat ?? '');
}

export function windName(seat: unknown) {
  return WIND_NAMES[seat as Seat] ?? String(seat ?? '');
}

export function ordinal(place: unknown) {
  const n = Number(place);
  if (!Number.isInteger(n) || n < 1) return '—';
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

// Japanese label for a season's LED tag: the time of year when the name says it,
// カジュアル for the unranked Casual category, otherwise シーズン.
export function seasonKanji(name: unknown, isCasual = false) {
  if (isCasual) return 'カジュアル';
  const text = String(name ?? '').toLowerCase();
  if (text.includes('spring')) return '春';
  if (text.includes('summer')) return '夏';
  if (text.includes('fall') || text.includes('autumn')) return '秋';
  if (text.includes('winter')) return '冬';
  return 'シーズン';
}
