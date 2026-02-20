<script lang="ts">
  export let data: any;
  export let form: any;

  let name = '';
  let start_date = '';
  let end_date = '';
  let is_active = false;
  let importSeasonId = data.activeSeason ?? '';
  let importRulesetId = data.defaultRules ?? '';
</script>

<div class="card" style="margin-bottom:12px;">
  <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:end;">
    <div>
      <div style="font-size:1.1rem; font-weight:650;">Seasons</div>
      <div class="muted">Create and manage seasons</div>
    </div>
    <a class="btn" href="/admin" style="text-decoration:none;">Back</a>
  </div>
</div>

{#if form?.message}
  <div class="card alert alert-success">
    {form.message}
  </div>
{/if}

<div class="card" style="margin-bottom:12px;">
  <h3 style="margin:0 0 10px;">Create season</h3>
  <form method="POST" action="?/create" style="display:flex; gap:10px; flex-wrap:wrap; align-items:end;">
    <label style="min-width:240px;">
      <div class="muted">Name</div>
      <input name="name" bind:value={name} placeholder="Spring 2026" required />
    </label>
    <label>
      <div class="muted">Start</div>
      <input name="start_date" bind:value={start_date} type="date" required />
    </label>
    <label>
      <div class="muted">End</div>
      <input name="end_date" bind:value={end_date} type="date" required />
    </label>
    <label style="display:flex; gap:8px; align-items:center; padding: 8px 0;">
      <input name="is_active" type="checkbox" bind:checked={is_active} />
      <span class="muted">Set active</span>
    </label>
    <button class="btn primary" type="submit">Create</button>
  </form>
</div>

<div class="card" style="margin-bottom:12px;">
  <h3 style="margin:0 0 10px;">Import season matches (Excel)</h3>
  <div class="muted" style="margin-bottom:10px;">
    Header must include: Date, Game, Tbl, E/S/W/N Player, E/S/W/N Pts, Ex.
  </div>
  <div class="muted" style="margin-bottom:10px;">
    Unknown player first names are auto-created as new players.
  </div>

  <form method="POST" action="?/importExcel" enctype="multipart/form-data" style="display:flex; gap:10px; flex-wrap:wrap; align-items:end;">
    <label style="min-width:240px;">
      <div class="muted">Season</div>
      <select name="season_id" bind:value={importSeasonId} required style="min-width:240px;">
        {#each data.seasons as s}
          <option value={s.id}>{s.name}{s.is_active ? ' (active)' : ''}</option>
        {/each}
      </select>
    </label>

    <label style="min-width:240px;">
      <div class="muted">Ruleset</div>
      <select name="ruleset_id" bind:value={importRulesetId} required style="min-width:240px;">
        {#each data.rulesets as r}
          <option value={r.id}>{r.name}</option>
        {/each}
      </select>
    </label>

    <label style="min-width:280px;">
      <div class="muted">Excel file</div>
      <input name="file" type="file" accept=".xlsx,.xls,.xlsm" required />
    </label>

    <button class="btn primary" type="submit">Import Excel</button>
  </form>

  {#if data.rulesets.length === 0}
    <div class="muted" style="margin-top:10px;">No rulesets found. Create one in SQL before importing.</div>
  {/if}
</div>

<div class="card">
  <h3 style="margin:0 0 10px;">Existing</h3>
  <div style="overflow:auto;">
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th style="width:160px;">Start</th>
          <th style="width:160px;">End</th>
          <th style="width:120px;">Active</th>
        </tr>
      </thead>
      <tbody>
        {#each data.seasons as s}
          <tr>
            <td>{s.name}</td>
            <td>{s.start_date}</td>
            <td>{s.end_date}</td>
            <td>{s.is_active ? 'Yes' : ''}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>
