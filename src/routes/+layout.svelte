<script lang="ts">
  import '../app.css';
  import { navigating, page } from '$app/stores';
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import { invalidate } from '$app/navigation';
  import { startPublicDataUpdates } from '$lib/public-data/live';

  export let data: import('./$types').LayoutData;

  const THEME_KEY = 'azrm-theme';

  type ThemePreference = 'system' | 'light' | 'dark';
  let themePreference: ThemePreference = 'system';
  let resolvedTheme: 'light' | 'dark' = 'light';
  let mobileNavDetails: HTMLDetailsElement | null = null;
  const SITE_NAME = 'AZRM Scoreboard';
  let pageTitle = SITE_NAME;

  onMount(() => startPublicDataUpdates(
    () => data.publicDataRevision,
    () => invalidate('app:public-data')
  ));

  function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object') return null;
    return value as Record<string, unknown>;
  }

  function asText(value: unknown): string | null {
    const text = String(value ?? '').trim();
    return text.length > 0 ? text : null;
  }

  function getFieldText(record: Record<string, unknown> | null, key: string): string | null {
    if (!record) return null;
    return asText(record[key]);
  }

  function resolvePageTitle(pathname: string, pageData: unknown): string {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length === 0) return SITE_NAME;
    const pageRecord = asRecord(pageData);
    const section = parts[0];

    if (section === 'login') return `Login | ${SITE_NAME}`;
    if (section === 'reset-password') return `Reset Password | ${SITE_NAME}`;
    if (section === 'seasons') return `Seasons | ${SITE_NAME}`;
    if (section === 'hall-of-fame') return `Hall of Fame | ${SITE_NAME}`;
    if (section === 'discipline') return `My Discipline | ${SITE_NAME}`;

    if (section === 'season') {
      const season = asRecord(pageRecord?.season);
      const seasonName = getFieldText(season, 'name');
      if (parts[2] === 'matches') return `${seasonName ?? 'Season'} Matches | ${SITE_NAME}`;
      return `${seasonName ?? 'Season Standings'} | ${SITE_NAME}`;
    }

    if (section === 'player') {
      const player = asRecord(pageRecord?.player);
      const primary =
        getFieldText(player, 'player_name_primary') ??
        getFieldText(player, 'real_first_name') ??
        getFieldText(player, 'display_name');
      const secondary = getFieldText(player, 'player_name_secondary');
      const playerName = primary ? (secondary ? `${primary} (${secondary})` : primary) : 'Player';
      return `${playerName} | ${SITE_NAME}`;
    }

    if (section === 'match') {
      const match = asRecord(pageRecord?.match);
      const label = getFieldText(match, 'table_label');
      const matchName = label ?? (parts[1] ? `Match ${parts[1].slice(0, 8)}` : 'Match');
      return `${matchName} | ${SITE_NAME}`;
    }

    if (section === 'admin') {
      if (parts.length === 1) return `Admin Dashboard | ${SITE_NAME}`;
      if (parts[1] === 'players') return `Admin Players | ${SITE_NAME}`;
      if (parts[1] === 'matches') return `Admin Matches | ${SITE_NAME}`;
      if (parts[1] === 'seasons') return `Admin Seasons | ${SITE_NAME}`;
      if (parts[1] === 'discipline') return `Admin Discipline | ${SITE_NAME}`;
      if (parts[1] === 'permissions') return `Admin Permissions | ${SITE_NAME}`;
      if (parts[1] === 'match') {
        const match = asRecord(pageRecord?.match);
        const label = getFieldText(match, 'table_label');
        const matchName = label ?? (parts[2] ? `Match ${parts[2].slice(0, 8)}` : 'Match');
        return `Admin ${matchName} | ${SITE_NAME}`;
      }
      return `Admin | ${SITE_NAME}`;
    }

    return SITE_NAME;
  }

  $: pageTitle = resolvePageTitle($page.url.pathname, $page.data);

  type NavSection = 'seasons' | 'standings' | 'hall-of-fame' | 'admin' | 'discipline' | 'login' | null;

  function navSection(pathname: string): NavSection {
    const section = pathname.split('/').filter(Boolean)[0];
    if (section === 'seasons') return 'seasons';
    if (section === 'season' || section === 'match' || section === 'player') return 'standings';
    if (section === 'hall-of-fame') return 'hall-of-fame';
    if (section === 'admin') return 'admin';
    if (section === 'discipline') return 'discipline';
    if (section === 'login' || section === 'reset-password') return 'login';
    return null;
  }

  $: activeNav = navSection($page.url.pathname);

  function normalizeTheme(value: string | null): ThemePreference {
    if (value === 'light' || value === 'dark' || value === 'system') return value;
    return 'system';
  }

  function applyThemePreference(pref: ThemePreference) {
    if (!browser) return;
    const root = document.documentElement;
    if (pref === 'light' || pref === 'dark') {
      root.setAttribute('data-theme', pref);
      try {
        localStorage.setItem(THEME_KEY, pref);
      } catch {}
      return;
    }
    root.removeAttribute('data-theme');
    try {
      localStorage.removeItem(THEME_KEY);
    } catch {}
  }

  function getSystemTheme(): 'light' | 'dark' {
    if (!browser) return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function updateResolvedTheme() {
    resolvedTheme = themePreference === 'system' ? getSystemTheme() : themePreference;
  }

  function hideBootSplash() {
    if (!browser) return;
    const splash = document.getElementById('azrm-boot-splash');
    if (!splash) return;

    splash.classList.add('is-hidden');
    window.setTimeout(() => splash.remove(), 220);
  }

  onMount(() => {
    if (!browser) return;
    let storedTheme: string | null = null;
    try {
      storedTheme = localStorage.getItem(THEME_KEY);
    } catch {}
    themePreference = normalizeTheme(storedTheme);
    applyThemePreference(themePreference);
    updateResolvedTheme();

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onMediaChange = () => updateResolvedTheme();
    media.addEventListener('change', onMediaChange);

    const onDocumentClick = (event: MouseEvent) => {
      if (!mobileNavDetails?.open || !(event.target instanceof Node)) return;
      if (!mobileNavDetails.contains(event.target)) mobileNavDetails.removeAttribute('open');
    };
    document.addEventListener('click', onDocumentClick);

    window.requestAnimationFrame(hideBootSplash);

    return () => {
      media.removeEventListener('change', onMediaChange);
      document.removeEventListener('click', onDocumentClick);
    };
  });

  function setThemePreference(next: 'light' | 'dark') {
    themePreference = themePreference === next ? 'system' : next;
    applyThemePreference(themePreference);
    updateResolvedTheme();
  }

  function dismissMobileMenu(node: HTMLElement) {
    const dismiss = () => mobileNavDetails?.removeAttribute('open');
    node.addEventListener('click', dismiss);
    return {
      destroy: () => node.removeEventListener('click', dismiss)
    };
  }
</script>

<svelte:head>
  <title>{pageTitle}</title>
</svelte:head>

{#if $navigating}
  <div class="route-loading" aria-hidden="true">
    <div class="route-loading__bar"></div>
  </div>
  <div class="sr-only" role="status" aria-live="polite">Loading page</div>
{/if}

<header class="app-header">
  <div class="app-header__in">
    <a class="app-brand" href="/" aria-label="AZRM Scoreboard home">
      <img class="app-logo" src="/azrm-logo.png" alt="" width="42" height="42" />
      <span class="app-brand__text">
        <span class="app-brand__kicker">AZ Riichi Mahjong</span>
        <span class="app-brand__name">Scoreboard</span>
      </span>
    </a>

    <div class="header-right">
      <nav class="desktop-header-nav" aria-label="Main">
        <a href="/seasons" class="nav-key" class:is-active={activeNav === 'seasons'} aria-current={activeNav === 'seasons' ? 'page' : undefined}>Seasons</a>
        {#if data.activeSeasonId}
          <a href={`/season/${data.activeSeasonId}`} class="nav-key" class:is-active={activeNav === 'standings'} aria-current={activeNav === 'standings' ? 'page' : undefined}>Standings</a>
        {/if}
        <a href="/hall-of-fame" class="nav-key" class:is-active={activeNav === 'hall-of-fame'} aria-current={activeNav === 'hall-of-fame' ? 'page' : undefined}>Hall of Fame</a>
        {#if data.isAdmin}
          <a href="/admin" class="nav-key" class:is-active={activeNav === 'admin'} aria-current={activeNav === 'admin' ? 'page' : undefined}>Admin</a>
        {/if}

        {#if data.user}
          <a href="/discipline" class="nav-key" class:is-active={activeNav === 'discipline'} aria-current={activeNav === 'discipline' ? 'page' : undefined}>My discipline</a>
          <span class="nav-session" title="Signed in">
            <span class="led-dot is-on" aria-hidden="true"></span>
            Signed in
            <form method="POST" action="/logout">
              <button class="nav-key" type="submit">Sign out</button>
            </form>
          </span>
        {:else}
          <a href="/login" class="nav-key" class:is-active={activeNav === 'login'} aria-current={activeNav === 'login' ? 'page' : undefined}>Sign in</a>
        {/if}
      </nav>

      <div class="theme-toggle" title={themePreference === 'system' ? 'Theme: System (auto)' : `Theme: ${themePreference}`}>
        <button
          class="theme-icon {resolvedTheme === 'light' ? 'is-active' : ''} {themePreference === 'system' && resolvedTheme === 'light' ? 'is-system' : ''}"
          type="button"
          aria-label="Use light theme (click again for system)"
          aria-pressed={resolvedTheme === 'light'}
          on:click={() => setThemePreference('light')}
        >
          ☀
        </button>
        <button
          class="theme-icon {resolvedTheme === 'dark' ? 'is-active' : ''} {themePreference === 'system' && resolvedTheme === 'dark' ? 'is-system' : ''}"
          type="button"
          aria-label="Use dark theme (click again for system)"
          aria-pressed={resolvedTheme === 'dark'}
          on:click={() => setThemePreference('dark')}
        >
          ☾
        </button>
      </div>

      <details class="mobile-nav" bind:this={mobileNavDetails}>
        <summary class="mobile-nav__summary" aria-label="Open navigation menu">
          <span aria-hidden="true">☰</span>
          <span class="mobile-nav__label">Menu</span>
        </summary>
        <div class="mobile-nav__panel" use:dismissMobileMenu>
          <nav class="mobile-nav__list" aria-label="Main">
            <a href="/seasons" class="nav-key" class:is-active={activeNav === 'seasons'}>Seasons</a>
            {#if data.activeSeasonId}
              <a href={`/season/${data.activeSeasonId}`} class="nav-key" class:is-active={activeNav === 'standings'}>Standings</a>
            {/if}
            <a href="/hall-of-fame" class="nav-key" class:is-active={activeNav === 'hall-of-fame'}>Hall of Fame</a>
            {#if data.isAdmin}
              <a href="/admin" class="nav-key" class:is-active={activeNav === 'admin'}>Admin</a>
            {/if}
            {#if data.user}
              <a href="/discipline" class="nav-key" class:is-active={activeNav === 'discipline'}>My discipline</a>
            {:else}
              <a href="/login" class="nav-key" class:is-active={activeNav === 'login'}>Sign in</a>
            {/if}
          </nav>

          {#if data.user}
            <div class="mobile-nav__auth">
              <span class="nav-session"><span class="led-dot is-on" aria-hidden="true"></span>Signed in</span>
              <form method="POST" action="/logout">
                <button class="nav-key mobile-nav__signout" type="submit">Sign out</button>
              </form>
            </div>
          {/if}
        </div>
      </details>
    </div>
  </div>
</header>

<div class="wrap">
  <slot />
</div>
