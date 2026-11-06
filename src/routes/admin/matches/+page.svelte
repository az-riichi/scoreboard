<script lang="ts">
  import { clickableRow } from '$lib/clickable-row';
  import { fmtDateTimeArizona as fmtDateTime, nowArizonaDatetimeLocalValue } from '$lib/arizona-time';
  import { hasAdminPermission } from '$lib/permissions';
  export let data: any;
  export let form: any;

  let season_id = data.activeSeason ?? '';
  let ruleset_id = data.defaultRules ?? '';
  let played_at = nowArizonaDatetimeLocalValue();
  let table_mode = 'A';
  let extra_sticks = 0;
  let notes = '';
  let casual_event_id = '';
  let new_casual_event_name = '';

  $: selectedSeason = data.seasons.find((season: any) => season.id === season_id) ?? null;
  $: isCasual = selectedSeason?.is_casual === true;
  $: access = data.adminAccess;
  $: canAddMatches = hasAdminPermission(access, 'add_matches');
  $: canRemoveMatches = hasAdminPermission(access, 'remove_matches');
  $: canManagePenalties = hasAdminPermission(access, 'manage_match_penalties');
  $: canRecomputeRatings = hasAdminPermission(access, 'recompute_ratings');
  $: canOpenMatches = canAddMatches || canRemoveMatches || canManagePenalties;
</script>

<style>
  .match-form {
    display: grid;
    gap: 10px;
  }

  .match-form__row {
    display: grid;
    grid-template-columns: 90px 120px minmax(0, 1fr) auto;
    gap: 10px 12px;
    align-items: end;
  }

  .match-table td {
    white-space: nowrap;
  }

  .match-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }

  .match-actions form {
    margin: 0;
  }

  .phone-only {
    display: none;
  }

  @media (max-width: 640px) {
    .match-form__row {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .match-form__notes,
    .match-form__row > .btn {
      grid-column: 1 / -1;
    }
  }

  /* One compact block per match once the columns stop fitting. */
  @media (max-width: 820px) {
    .match-table,
    .match-table tbody {
      display: block;
    }

    .match-table thead,
    .cell-ex {
      display: none;
    }

    .match-table tr {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      grid-template-areas:
        'game status action'
        'date date action'
        'season season action';
      gap: 2px 8px;
      align-items: center;
      padding: 10px 0;
      border-bottom: 1px solid var(--table-row);
    }

    .match-table tr:last-child {
      border-bottom: 0;
    }

    .match-table td {
      padding: 0;
      border: 0;
      white-space: normal;
    }

    .cell-game {
      grid-area: game;
      font-weight: 600;
    }

    .cell-status { grid-area: status; }
    .cell-actions { grid-area: action; }

    .cell-date,
    .cell-season {
      color: var(--muted);
      font-size: var(--type-small);
    }

    .cell-date { grid-area: date; }
    .cell-season { grid-area: season; }

    .phone-only {
      display: inline;
    }
  }

  /* The row opens the match, and Public and Delete are on that page. */
  @media (max-width: 560px) {
    .desktop-only {
      display: none;
    }
  }
</style>

<div class="card" style="margin-bottom:12px;">
  <div class="card-head">
    <div>
      <div class="title-row">
        <span class="led-tag" lang="ja" aria-hidden="true">対局</span>
        <h1 class="page-title">Matches</h1>
      </div>
    </div>
    <div style="display:flex; gap:8px; flex-wrap:wrap;">
      {#if canRecomputeRatings}
        <form method="POST" action="?/recomputeLifetimeR" on:submit={(e) => { if (!confirm('Recompute all season and lifetime ratings?')) e.preventDefault(); }}>
          <button class="btn" type="submit">Recompute ratings</button>
        </form>
      {/if}
      <a class="btn" href="/admin">Back</a>
    </div>
  </div>
</div>

{#if form?.message}
  <div class="card alert alert-warning">
    {form.message}
  </div>
{/if}

{#if canAddMatches}
  <div class="card" style="margin-bottom:12px;">
    <h2 class="card-title">Create match</h2>
  <div class="muted" style="margin:4px 0 12px;">Game # and table label are auto-generated</div>
  <form method="POST" action="?/create" class="match-form">
    <div class="form-grid">
      <label class="field">
        <span class="muted">Season</span>
        <select name="season_id" bind:value={season_id} required>
          {#each data.seasons as s}
            <option value={s.id}>{s.name}{s.is_casual ? ' (no time limit)' : ''}{s.is_active ? ' (active)' : ''}</option>
          {/each}
        </select>
      </label>

      <label class="field">
        <span class="muted">Ruleset</span>
        <select name="ruleset_id" bind:value={ruleset_id} required>
          {#each data.rulesets as r}
            <option value={r.id}>{r.name}</option>
          {/each}
        </select>
      </label>

      <label class="field">
        <span class="muted">Played at</span>
        <input name="played_at" type="datetime-local" bind:value={played_at} required />
      </label>

      {#if isCasual}
        <label class="field">
          <span class="muted">Event</span>
          <select name="casual_event_id" bind:value={casual_event_id}>
            <option value="">Uncategorized</option>
            {#each data.casualEvents as event}
              <option value={event.id}>{event.name}</option>
            {/each}
            <option value="__new__">+ Add new event…</option>
          </select>
        </label>

        {#if casual_event_id === '__new__'}
          <label class="field">
            <span class="muted">New event name</span>
            <input
              name="new_casual_event_name"
              bind:value={new_casual_event_name}
              maxlength="100"
              placeholder="Event name"
              required
            />
          </label>
        {/if}
      {/if}
    </div>

    {#if isCasual}
      <div class="muted">Casual matches can be played on any date and do not change seasonal or lifetime ratings.</div>
    {/if}

    <div class="match-form__row">
      <label class="field">
        <span class="muted">Tbl type</span>
        <select name="table_mode" bind:value={table_mode}>
          <option value="A">A</option>
          <option value="M">M</option>
        </select>
      </label>

      <label class="field">
        <span class="muted">Extra points</span>
        <input name="extra_sticks" type="number" min="0" step="1000" bind:value={extra_sticks} />
      </label>

      <label class="field match-form__notes">
        <span class="muted">Notes (optional)</span>
        <input name="notes" bind:value={notes} placeholder="Match notes" />
      </label>

      <button class="btn primary" type="submit">Create draft</button>
    </div>
  </form>

  {#if data.rulesets.length === 0}
    <div class="muted" style="margin-top:10px;">No rulesets found. Run the schema seed or create one in SQL.</div>
  {/if}
  </div>
{/if}

{#if canOpenMatches}
  <div class="card">
    <h2 class="card-title">Recent matches</h2>
    <div style="overflow-x:auto; margin-top:12px;">
      <table class="match-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Game</th>
          <th>Season</th>
          <th>Ex</th>
          <th>Status</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {#each data.recentMatches as m}
          <tr use:clickableRow={`/admin/match/${m.id}`}>
            <td class="cell-date">{fmtDateTime(m.played_at)}</td>
            <td class="cell-game">{m.table_mode ?? ''}{m.game_number ?? ''}</td>
            <td class="cell-season">
              {m.season_name}{m.casual_event_name ? ` · ${m.casual_event_name}` : ''}
              {#if Number(m.extra_sticks) > 0}
                <span class="phone-only">· Ex {m.extra_sticks}</span>
              {/if}
            </td>
            <td class="cell-ex">{m.extra_sticks ?? 0}</td>
            <td class="cell-status">
              <span class="tag">
                <span class="led-dot" class:is-on={m.status === 'final'} class:is-amber={m.status !== 'final'} aria-hidden="true"></span>
                {m.status}
              </span>
            </td>
            <td class="cell-actions">
              <div class="match-actions">
                <a class="btn" href={`/admin/match/${m.id}`}>Open</a>
                {#if m.status === 'final'}
                  <a class="btn desktop-only" href={`/match/${m.id}`}>Public</a>
                {/if}
                {#if canRemoveMatches}
                  <form class="desktop-only" method="POST" action="?/delete" on:submit={(e) => { if (!confirm('Delete this game? This cannot be undone.')) e.preventDefault(); }}>
                    <input type="hidden" name="match_id" value={m.id} />
                    <button class="btn danger" type="submit">Delete</button>
                  </form>
                {/if}
              </div>
            </td>
          </tr>
        {/each}
      </tbody>
      </table>
    </div>
  </div>
{/if}
