<script lang="ts">
  import { hasAdminPermission } from '$lib/permissions';

  export let data: any;
  export let form: any;

  let name = '';
  let start_date = '';
  let end_date = '';
  let is_active = false;
  let importSeasonId = data.activeSeason ?? '';
  let importRulesetId = data.defaultRules ?? '';
  $: access = data.adminAccess;
  $: canManageSeasons = hasAdminPermission(access, 'manage_seasons');
  $: canImportMatches = hasAdminPermission(access, 'import_matches');
  $: canAddPlayers = hasAdminPermission(access, 'add_players');
</script>

<style>
  /* Ruleset names are long, so that column gets the most room. */
  @media (min-width: 761px) {
    .import-form {
      grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.3fr) minmax(0, 1.2fr) auto;
    }
  }

  /* The period already says "No time limit" for the one casual category. */
  @media (max-width: 560px) {
    .col-type {
      display: none;
    }
  }
</style>

<div class="card" style="margin-bottom:12px;">
  <div class="card-head">
    <div>
      <div class="title-row">
        <span class="led-tag" lang="ja" aria-hidden="true">シーズン</span>
        <h1 class="page-title">Seasons</h1>
      </div>
    </div>
    <a class="btn" href="/admin">Back</a>
  </div>
</div>

{#if form?.message}
  <div class="card alert alert-success">
    {form.message}
  </div>
{/if}

{#if canManageSeasons}
  <div class="card" style="margin-bottom:12px;">
    <h2 class="card-title">Create regular season</h2>
    <div class="muted" style="margin:4px 0 12px;">Casual is a permanent, date-free category and is created automatically.</div>
    <form method="POST" action="?/create" class="form-grid">
      <label class="field">
        <span class="muted">Name</span>
        <input name="name" bind:value={name} placeholder="Spring 2026" required />
      </label>
      <label class="field">
        <span class="muted">Start</span>
        <input name="start_date" bind:value={start_date} type="date" required />
      </label>
      <label class="field">
        <span class="muted">End</span>
        <input name="end_date" bind:value={end_date} type="date" required />
      </label>
      <label class="check-field">
        <input name="is_active" type="checkbox" bind:checked={is_active} />
        <span class="muted">Set active</span>
      </label>
      <button class="btn primary" type="submit">Create</button>
    </form>
  </div>
{/if}

{#if canImportMatches}
  <div class="card" style="margin-bottom:12px;">
    <h2 class="card-title">Import season matches (Excel)</h2>
    <div class="muted" style="margin:4px 0 10px;">
      Header must include: Date, Game, Tbl, E/S/W/N Player, E/S/W/N Pts, Ex
    </div>
    <div class="muted" style="margin-bottom:10px;">
      {#if canAddPlayers}
        Unknown player first names are auto-created as new players
      {:else}
        Every player must already exist; auto-creating unknown players requires Add players
      {/if}
    </div>

    <form method="POST" action="?/importExcel" enctype="multipart/form-data" class="form-grid import-form">
      <label class="field">
        <span class="muted">Season</span>
        <select name="season_id" bind:value={importSeasonId} required>
          {#each data.seasons as s}
            <option value={s.id}>{s.name}{s.is_casual ? ' (no time limit)' : ''}{s.is_active ? ' (active)' : ''}</option>
          {/each}
        </select>
      </label>

      <label class="field">
        <span class="muted">Ruleset</span>
        <select name="ruleset_id" bind:value={importRulesetId} required>
          {#each data.rulesets as r}
            <option value={r.id}>{r.name}</option>
          {/each}
        </select>
      </label>

      <label class="field">
        <span class="muted">Excel file</span>
        <input name="file" type="file" accept=".xlsx,.xls,.xlsm" required />
      </label>

      <button class="btn primary" type="submit">Import</button>
    </form>

    {#if data.rulesets.length === 0}
      <div class="muted" style="margin-top:10px;">No rulesets found. Create one in SQL before importing.</div>
    {/if}
  </div>
{/if}

<div class="card">
  <h2 class="card-title">Existing</h2>
  <div style="overflow:auto; margin-top:12px;">
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th class="col-type" style="width:120px;">Type</th>
          <th style="width:250px;">Period</th>
          <th style="width:110px;"><span class="sr-only">Active</span></th>
        </tr>
      </thead>
      <tbody>
        {#each data.seasons as s}
          <tr>
            <td style="font-weight:600;">{s.name}</td>
            <td class="col-type"><span class="tag">{s.is_casual ? 'Casual' : 'Regular'}</span></td>
            <td>{s.is_casual ? 'No time limit' : `${s.start_date} → ${s.end_date}`}</td>
            <td>
              {#if s.is_active}
                <span class="status-live"><span class="led-dot is-on" aria-hidden="true"></span>Active</span>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>
