import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import { getPublicSnapshot, onPublicDataRevision } from './cache';

const REFRESH_DELAY_MS = 250;
const FALLBACK_INTERVAL_MS = 60_000;

/** Mount once in the root layout; refresh the cache before rerunning public loads. */
export function startPublicDataUpdates(
  displayedRevision: () => string,
  refreshPage: () => Promise<void>
): () => void {
  // This subscription only reads the public revision marker and needs no user
  // session. Keep it independent of the server-managed authentication cookies.
  const supabase = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  let stopped = false;
  let refreshing = false;
  let pending = false;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;

  function canRefresh() {
    return !stopped && document.visibilityState === 'visible' && navigator.onLine !== false;
  }

  function requestRefresh() {
    if (stopped) return;
    pending = true;
    if (!canRefresh() || refreshing || refreshTimer !== null) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void refresh();
    }, REFRESH_DELAY_MS);
  }

  async function refresh() {
    if (!canRefresh()) return;
    pending = false;
    refreshing = true;
    try {
      const snapshot = await getPublicSnapshot();
      if (!stopped && String(snapshot.revision.revision) !== displayedRevision()) {
        await refreshPage();
      }
    } catch {
      // Keep the current page usable. Reconnect, visibility, and the periodic
      // check retry a failed refresh without replacing good data with an error.
    } finally {
      refreshing = false;
      // A match published during an in-flight request needs a follow-up check.
      if (pending) requestRefresh();
    }
  }

  function onRevision(revision: unknown) {
    const next = String(revision ?? '');
    if (/^\d+$/.test(next) && BigInt(next) > BigInt(displayedRevision())) requestRefresh();
  }

  const stopOtherTabs = onPublicDataRevision(onRevision);
  const channel = supabase
    .channel('public-scoreboard-revision')
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'public_data_revision', filter: 'scope=eq.scoreboard' },
      (payload) => onRevision(payload.new.revision)
    )
    .subscribe((status) => {
      // Check after every join, including reconnects, to close any gap between
      // the initial snapshot and the subscription becoming ready.
      if (status === 'SUBSCRIBED') requestRefresh();
    });

  document.addEventListener('visibilitychange', requestRefresh);
  window.addEventListener('online', requestRefresh);
  const fallbackTimer = setInterval(requestRefresh, FALLBACK_INTERVAL_MS);

  return () => {
    stopped = true;
    if (refreshTimer !== null) clearTimeout(refreshTimer);
    clearInterval(fallbackTimer);
    document.removeEventListener('visibilitychange', requestRefresh);
    window.removeEventListener('online', requestRefresh);
    stopOtherTabs();
    void supabase.removeChannel(channel);
    void supabase.auth.dispose();
  };
}
