import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { goto } from '$app/navigation';
import {
  backToSeason,
  rememberSeasonView,
  returningSeasonView,
  type SeasonView
} from './season-return';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

const SEASON_URL = 'https://example.test/season/fall?event=e1';
const VIEW: SeasonView = {
  scrollY: 800,
  sortKey: 'sp',
  sortDir: 'desc',
  standingsView: 'all'
};

function click(init: Partial<MouseEvent> = {}) {
  const listeners: ((event: MouseEvent) => Promise<void>)[] = [];
  const node = {
    href: SEASON_URL,
    addEventListener: (_type: string, listener: (event: MouseEvent) => Promise<void>) =>
      listeners.push(listener),
    removeEventListener: vi.fn()
  } as unknown as HTMLAnchorElement;
  backToSeason(node);

  const event = { button: 0, preventDefault: vi.fn(), ...init } as unknown as MouseEvent;
  return { event, done: listeners[0](event) };
}

describe('backToSeason', () => {
  const scrollTo = vi.fn();

  beforeEach(() => {
    const stored = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value)
    });
    vi.stubGlobal('window', { scrollTo });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('reopens the saved view and scroll position of that season page', async () => {
    rememberSeasonView(new URL(SEASON_URL), VIEW);
    let viewDuringNavigation: SeasonView | null = null;
    vi.mocked(goto).mockImplementation(async () => {
      viewDuringNavigation = returningSeasonView();
    });

    const { event, done } = click();
    await done;

    expect(event.preventDefault).toHaveBeenCalled();
    expect(goto).toHaveBeenCalledWith(SEASON_URL, { noScroll: true });
    expect(viewDuringNavigation).toEqual(VIEW);
    expect(scrollTo).toHaveBeenCalledWith(0, 800);
    expect(returningSeasonView()).toBeNull();
  });

  it('stays a plain link when that season page has not been left yet', async () => {
    rememberSeasonView(new URL('https://example.test/season/fall'), VIEW);

    const { event, done } = click();
    await done;

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(goto).not.toHaveBeenCalled();
  });

  it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }])(
    'leaves a new-tab click alone: %o',
    async (modifier) => {
      rememberSeasonView(new URL(SEASON_URL), VIEW);

      const { event, done } = click(modifier);
      await done;

      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(goto).not.toHaveBeenCalled();
    }
  );

  it('clears the returning view when navigation fails', async () => {
    rememberSeasonView(new URL(SEASON_URL), VIEW);
    vi.mocked(goto).mockRejectedValue(new Error('offline'));

    const { done } = click();

    await expect(done).rejects.toThrow('offline');
    expect(returningSeasonView()).toBeNull();
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
