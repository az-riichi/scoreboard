<script lang="ts">
  import { navigating, page } from '$app/stores';
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';

  export let data: import('./$types').LayoutData;

  const navA =
    'padding:6px 10px; border-radius:10px; text-decoration:none; border:1px solid var(--nav-border); background:var(--nav-bg);';
  const pill =
    'display:inline-flex; gap:8px; align-items:center; padding:6px 10px; border-radius:999px; border:1px solid var(--pill-border); background:var(--pill-bg);';
  const THEME_KEY = 'azrm-theme';

  type ThemePreference = 'system' | 'light' | 'dark';
  let themePreference: ThemePreference = 'system';
  let resolvedTheme: 'light' | 'dark' = 'light';
  const SITE_NAME = 'AZRM Scoreboard';
  let pageTitle = SITE_NAME;

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
    if (section === 'seasons') return `Seasons | ${SITE_NAME}`;

    if (section === 'season') {
      const season = asRecord(pageRecord?.season);
      const seasonName = getFieldText(season, 'name');
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
    (window as Window & { __azrmHideSplash?: () => void }).__azrmHideSplash?.();
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

    window.requestAnimationFrame(hideBootSplash);

    return () => media.removeEventListener('change', onMediaChange);
  });

  function setThemePreference(next: 'light' | 'dark') {
    themePreference = themePreference === next ? 'system' : next;
    applyThemePreference(themePreference);
    updateResolvedTheme();
  }
</script>

<svelte:head>
  <title>{pageTitle}</title>
  <style>
    :root {
      color-scheme: light;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      --bg: #f5f7fb;
      --text: #111827;
      --muted: #5f6b7a;
      --card-bg: #ffffff;
      --card-border: #e2e8f0;
      --btn-bg: #ffffff;
      --btn-border: #cdd5df;
      --btn-primary-bg: #111827;
      --btn-primary-text: #f8fafc;
      --field-bg: #ffffff;
      --field-border: #cdd5df;
      --table-border: #e2e8f0;
      --table-head: #5f6b7a;
      --nav-bg: #ffffff;
      --nav-border: #dbe3ec;
      --pill-bg: #eef2f7;
      --pill-border: #dbe3ec;
      --alert-success-bg: #ecfdf3;
      --alert-success-border: #86efac;
      --alert-success-text: #14532d;
      --alert-warning-bg: #fff7ed;
      --alert-warning-border: #fdba74;
      --alert-warning-text: #7c2d12;
      --alert-error-bg: #fef2f2;
      --alert-error-border: #fca5a5;
      --alert-error-text: #7f1d1d;
    }

    @media (prefers-color-scheme: dark) {
      :root:not([data-theme='light']) {
        color-scheme: dark;
        --bg: #0d1117;
        --text: #e6edf3;
        --muted: #9aa7b5;
        --card-bg: #141b24;
        --card-border: #2b3644;
        --btn-bg: #1a2330;
        --btn-border: #334255;
        --btn-primary-bg: #e6edf3;
        --btn-primary-text: #0d1117;
        --field-bg: #101722;
        --field-border: #334255;
        --table-border: #2b3644;
        --table-head: #9aa7b5;
        --nav-bg: #141b24;
        --nav-border: #2b3644;
        --pill-bg: #1a2330;
        --pill-border: #2b3644;
        --alert-success-bg: #0f2a1d;
        --alert-success-border: #2f7d55;
        --alert-success-text: #b8f7cc;
        --alert-warning-bg: #2d1d12;
        --alert-warning-border: #8a4b21;
        --alert-warning-text: #ffd9b0;
        --alert-error-bg: #321516;
        --alert-error-border: #8f2f35;
        --alert-error-text: #ffb4b8;
      }
    }

    :root[data-theme='light'] {
      color-scheme: light;
      --bg: #f5f7fb;
      --text: #111827;
      --muted: #5f6b7a;
      --card-bg: #ffffff;
      --card-border: #e2e8f0;
      --btn-bg: #ffffff;
      --btn-border: #cdd5df;
      --btn-primary-bg: #111827;
      --btn-primary-text: #f8fafc;
      --field-bg: #ffffff;
      --field-border: #cdd5df;
      --table-border: #e2e8f0;
      --table-head: #5f6b7a;
      --nav-bg: #ffffff;
      --nav-border: #dbe3ec;
      --pill-bg: #eef2f7;
      --pill-border: #dbe3ec;
      --alert-success-bg: #ecfdf3;
      --alert-success-border: #86efac;
      --alert-success-text: #14532d;
      --alert-warning-bg: #fff7ed;
      --alert-warning-border: #fdba74;
      --alert-warning-text: #7c2d12;
      --alert-error-bg: #fef2f2;
      --alert-error-border: #fca5a5;
      --alert-error-text: #7f1d1d;
    }

    :root[data-theme='dark'] {
      color-scheme: dark;
      --bg: #0d1117;
      --text: #e6edf3;
      --muted: #9aa7b5;
      --card-bg: #141b24;
      --card-border: #2b3644;
      --btn-bg: #1a2330;
      --btn-border: #334255;
      --btn-primary-bg: #e6edf3;
      --btn-primary-text: #0d1117;
      --field-bg: #101722;
      --field-border: #334255;
      --table-border: #2b3644;
      --table-head: #9aa7b5;
      --nav-bg: #141b24;
      --nav-border: #2b3644;
      --pill-bg: #1a2330;
      --pill-border: #2b3644;
      --alert-success-bg: #0f2a1d;
      --alert-success-border: #2f7d55;
      --alert-success-text: #b8f7cc;
      --alert-warning-bg: #2d1d12;
      --alert-warning-border: #8a4b21;
      --alert-warning-text: #ffd9b0;
      --alert-error-bg: #321516;
      --alert-error-border: #8f2f35;
      --alert-error-text: #ffb4b8;
    }

    body { margin: 0; background: var(--bg); color: var(--text); }
    a { color: inherit; }
    .wrap { max-width: 1080px; margin: 0 auto; padding: 18px 14px 40px; }
    .card { border: 1px solid var(--card-border); border-radius: 16px; padding: 14px; background: var(--card-bg); }
    .alert {
      margin-bottom: 12px;
      border-width: 1px;
      border-style: solid;
    }
    .alert-success {
      border-color: var(--alert-success-border);
      background: var(--alert-success-bg);
      color: var(--alert-success-text);
    }
    .alert-warning {
      border-color: var(--alert-warning-border);
      background: var(--alert-warning-bg);
      color: var(--alert-warning-text);
    }
    .alert-error {
      border-color: var(--alert-error-border);
      background: var(--alert-error-bg);
      color: var(--alert-error-text);
    }
    .muted { color: var(--muted); font-size: 0.95rem; }
    .btn {
      border: 1px solid var(--btn-border);
      background: var(--btn-bg);
      padding: 8px 12px;
      border-radius: 12px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      line-height: 1.2;
      font: inherit;
      color: inherit;
      text-decoration: none;
      appearance: none;
      -webkit-appearance: none;
    }
    .btn.primary {
      border-color: var(--btn-primary-bg);
      background: var(--btn-primary-bg);
      color: var(--btn-primary-text);
    }
    input, select, textarea {
      padding: 8px 10px;
      border-radius: 12px;
      border: 1px solid var(--field-border);
      background: var(--field-bg);
      color: var(--text);
    }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px 8px; border-bottom: 1px solid var(--table-border); text-align: left; }
    th { font-size: 0.85rem; color: var(--table-head); }
    .theme-toggle {
      display: inline-flex;
      gap: 4px;
      align-items: center;
      border: 1px solid var(--nav-border);
      background: var(--nav-bg);
      border-radius: 999px;
      padding: 3px;
    }
    .theme-icon {
      width: 30px;
      height: 30px;
      border-radius: 999px;
      border: none;
      background: transparent;
      color: var(--muted);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      padding: 0;
      font-size: 0.95rem;
      line-height: 1;
    }
    .theme-icon:hover {
      background: var(--pill-bg);
      color: var(--text);
    }
    .theme-icon.is-active {
      background: var(--pill-bg);
      color: var(--text);
    }
    .theme-icon.is-system {
      opacity: 0.75;
    }
    .grid2 { display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .route-loading {
      position: fixed;
      inset: 0 0 auto 0;
      height: 3px;
      z-index: 1000;
      pointer-events: none;
      background: transparent;
    }
    .route-loading__bar {
      height: 100%;
      width: 40%;
      border-radius: 0 999px 999px 0;
      background: linear-gradient(90deg, var(--btn-primary-bg), var(--text));
      animation: route-loading-slide 1s ease-in-out infinite;
      box-shadow: 0 0 0 1px rgba(127, 127, 127, 0.15);
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    @keyframes route-loading-slide {
      0% {
        transform: translateX(-120%);
        opacity: 0.4;
      }
      50% {
        opacity: 1;
      }
      100% {
        transform: translateX(280%);
        opacity: 0.4;
      }
    }
    @media (max-width: 780px) { .grid2 { grid-template-columns: 1fr; } }
  </style>
</svelte:head>

{#if $navigating}
  <div class="route-loading" aria-hidden="true">
    <div class="route-loading__bar"></div>
  </div>
  <div class="sr-only" role="status" aria-live="polite">Loading page</div>
{/if}

<div class="wrap">
  <header style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:16px;">
    <div style="display:flex; flex-direction:column;">
      <a href="/" style="text-decoration:none;">
        <div style="font-size:1.25rem; font-weight:650;">AZRM Scoreboard</div>
      </a>
    </div>

    <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap; justify-content:flex-end;">
      <a href="/seasons" style={navA}>Seasons</a>
      {#if data.activeSeasonId}
        <a href={`/season/${data.activeSeasonId}`} style={navA}>Standings</a>
      {/if}
      {#if data.isAdmin}
        <a href="/admin" style={navA}>Admin</a>
      {/if}
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

      {#if data.user}
        <span style={pill} title="Signed in">
          <span class="muted">Signed in</span>
          <form method="POST" action="/logout" style="margin:0;">
            <button class="btn" type="submit">Sign out</button>
          </form>
        </span>
      {:else}
        <a href="/login" style={navA}>Admin</a>
      {/if}
    </div>
  </header>

  <slot />
</div>
