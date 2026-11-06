import { goto } from '$app/navigation';

export type SortKey = 'rank' | 'player' | 'rating' | 'sp' | 'games' | 'avg' | 'top2';
export type SortDir = 'asc' | 'desc';
export type StandingsView = 'eligible' | 'all';

/** How the season page looked when the visitor left it. */
export type SeasonView = {
  scrollY: number;
  sortKey: SortKey;
  sortDir: SortDir;
  standingsView: StandingsView;
};

let returningView: SeasonView | null = null;

function storageKey(url: URL) {
  return `season-view:${url.pathname}${url.search}`;
}

export function rememberSeasonView(url: URL, view: SeasonView) {
  try {
    sessionStorage.setItem(storageKey(url), JSON.stringify(view));
  } catch {
    // Storage can be unavailable. The link then just opens the top of the page.
  }
}

function savedSeasonView(url: URL): SeasonView | null {
  try {
    const saved = sessionStorage.getItem(storageKey(url));
    return saved ? (JSON.parse(saved) as SeasonView) : null;
  } catch {
    return null;
  }
}

/** The view to reopen, while "Back to season" is what is bringing up the season page. */
export function returningSeasonView() {
  return returningView;
}

/**
 * Makes a "Back to season" link return to where the visitor left that season page.
 * It stays a plain link when there is nothing to return to, or for a new-tab click.
 */
export function backToSeason(node: HTMLAnchorElement) {
  async function handleClick(event: MouseEvent) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
      return;
    }

    const view = savedSeasonView(new URL(node.href));
    if (!view) return;

    event.preventDefault();
    returningView = view;
    try {
      await goto(node.href, { noScroll: true });
      window.scrollTo(0, view.scrollY);
    } finally {
      returningView = null;
    }
  }

  node.addEventListener('click', handleClick);

  return {
    destroy() {
      node.removeEventListener('click', handleClick);
    }
  };
}
