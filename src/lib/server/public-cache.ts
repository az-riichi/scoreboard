type ServerSupabase = App.Locals['supabase'];

type CacheEntry<T> = {
  expiresAt: number;
  value?: T;
  pending?: Promise<T>;
};

export type LifetimeRatingSnapshot = {
  latestRateByPlayer: Map<string, number>;
  gamesByPlayer: Map<string, number>;
  rankByPlayer: Map<string, number>;
  totalPlayers: number;
  updatedAtByPlayer: Map<string, string | null>;
};

const ACTIVE_SEASON_TTL_MS = 30_000;
const RATING_START_DATE_TTL_MS = 5 * 60_000;
const LIFETIME_RATING_SNAPSHOT_TTL_MS = 15_000;
const FALLBACK_RATING_START_DATE = '2026-01-01';

const singletonCache = {
  activeSeasonId: new Map<string, CacheEntry<string | null>>(),
  ratingStartDate: new Map<string, CacheEntry<string>>(),
  lifetimeRatings: new Map<string, CacheEntry<LifetimeRatingSnapshot>>()
};

async function readThroughCache<T>(
  store: Map<string, CacheEntry<T>>,
  key: string,
  ttlMs: number,
  loader: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const existing = store.get(key);
  if (existing && existing.expiresAt > now && 'value' in existing) {
    return existing.value as T;
  }
  if (existing?.pending) return existing.pending;

  const pending = loader()
    .then((value) => {
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .catch((error) => {
      const current = store.get(key);
      if (current?.pending === pending) {
        if ('value' in current && current.expiresAt > Date.now()) {
          store.set(key, { value: current.value as T, expiresAt: current.expiresAt });
        } else {
          store.delete(key);
        }
      }
      throw error;
    });

  store.set(key, {
    expiresAt: existing?.expiresAt ?? 0,
    value: existing?.value,
    pending
  });

  return pending;
}

function emptyLifetimeRatingSnapshot(): LifetimeRatingSnapshot {
  return {
    latestRateByPlayer: new Map(),
    gamesByPlayer: new Map(),
    rankByPlayer: new Map(),
    totalPlayers: 0,
    updatedAtByPlayer: new Map()
  };
}

export async function getActiveSeasonId(supabase: ServerSupabase): Promise<string | null> {
  return readThroughCache(singletonCache.activeSeasonId, 'active', ACTIVE_SEASON_TTL_MS, async () => {
    const { data } = await supabase
      .from('seasons')
      .select('id')
      .eq('is_active', true)
      .order('start_date', { ascending: false })
      .limit(1);

    return data?.[0]?.id ?? null;
  });
}

export async function getRatingStartDate(supabase: ServerSupabase): Promise<string> {
  return readThroughCache(singletonCache.ratingStartDate, 'lifetime-rating-start', RATING_START_DATE_TTL_MS, async () => {
    const ratingStartSeasonRes = await supabase
      .from('seasons')
      .select('start_date')
      .ilike('name', 'spring 2026%')
      .order('start_date', { ascending: true })
      .limit(1)
      .maybeSingle();

    return String(ratingStartSeasonRes.data?.start_date ?? '').trim() || FALLBACK_RATING_START_DATE;
  });
}

export async function getLifetimeRatingSnapshot(
  supabase: ServerSupabase,
  ratingStartDate: string
): Promise<LifetimeRatingSnapshot> {
  return readThroughCache(
    singletonCache.lifetimeRatings,
    `lifetime:${ratingStartDate}`,
    LIFETIME_RATING_SNAPSHOT_TTL_MS,
    async () => {
      const res = await supabase
        .from('v_rating_history')
        .select('player_id, new_rate, played_at, match_id')
        .eq('is_lifetime', true)
        .gte('played_at', ratingStartDate)
        .order('played_at', { ascending: false })
        .order('match_id', { ascending: false });

      if (res.error) return emptyLifetimeRatingSnapshot();

      const latestRateByPlayer = new Map<string, number>();
      const gamesByPlayer = new Map<string, number>();
      const updatedAtByPlayer = new Map<string, string | null>();

      for (const row of res.data ?? []) {
        const rowPlayerId = String(row?.player_id ?? '').trim();
        const rate = Number(row?.new_rate);
        const playedAt = String(row?.played_at ?? '').trim() || null;
        if (!rowPlayerId) continue;

        gamesByPlayer.set(rowPlayerId, (gamesByPlayer.get(rowPlayerId) ?? 0) + 1);
        if (!Number.isFinite(rate) || latestRateByPlayer.has(rowPlayerId)) continue;

        latestRateByPlayer.set(rowPlayerId, rate);
        updatedAtByPlayer.set(rowPlayerId, playedAt);
      }

      const rows = Array.from(latestRateByPlayer.entries())
        .map(([player_id, rate]) => ({ player_id, rate }))
        .sort((a, b) => {
          if (a.rate !== b.rate) return b.rate - a.rate;
          return a.player_id.localeCompare(b.player_id);
        });

      const rankByPlayer = new Map<string, number>();
      let prevRate: number | null = null;
      let rank = 0;
      for (const row of rows) {
        if (prevRate == null || row.rate !== prevRate) {
          rank += 1;
          prevRate = row.rate;
        }
        rankByPlayer.set(row.player_id, rank);
      }

      return {
        latestRateByPlayer,
        gamesByPlayer,
        rankByPlayer,
        totalPlayers: rows.length,
        updatedAtByPlayer
      };
    }
  );
}
