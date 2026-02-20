<script lang="ts">
  export let data: import('./$types').LayoutData;

  const navA = 'padding:6px 10px; border-radius:10px; text-decoration:none;';
  const pill = 'display:inline-flex; gap:8px; align-items:center; padding:6px 10px; border-radius:999px; background:#f2f2f2;';
</script>

<svelte:head>
  <style>
    :root { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; }
    body { margin: 0; background: #fff; color: #111; }
    a { color: inherit; }
    .wrap { max-width: 1080px; margin: 0 auto; padding: 18px 14px 40px; }
    .card { border: 1px solid #e6e6e6; border-radius: 16px; padding: 14px; background: #fff; }
    .muted { color: #666; font-size: 0.95rem; }
    .btn { border: 1px solid #ddd; background: #fff; padding: 8px 12px; border-radius: 12px; cursor: pointer; }
    .btn.primary { border-color: #111; background: #111; color: #fff; }
    input, select, textarea { padding: 8px 10px; border-radius: 12px; border: 1px solid #ddd; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px 8px; border-bottom: 1px solid #eee; text-align: left; }
    th { font-size: 0.85rem; color: #666; }
    .grid2 { display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    @media (max-width: 780px) { .grid2 { grid-template-columns: 1fr; } }
  </style>
</svelte:head>

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

      {#if data.session}
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
