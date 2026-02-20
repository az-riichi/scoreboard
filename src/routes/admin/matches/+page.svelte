<script lang="ts">
  import { fmtDateTime } from '$lib/ui';
  export let data: any;
  export let form: any;

  let season_id = data.activeSeason ?? '';
  let ruleset_id = data.defaultRules ?? '';
  let played_at = new Date().toISOString().slice(0,16);
  let table_label = '';
  let game_number = '';
  let table_mode = 'A';
  let extra_sticks = 0;
</script>

<div class="card" style="margin-bottom:12px;">
  <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:end;">
    <div>
      <div style="font-size:1.1rem; font-weight:650;">Matches</div>
      <div class="muted">Create a draft match, enter results, then finalize.</div>
    </div>
    <a class="btn" href="/admin" style="text-decoration:none;">Back</a>
  </div>
</div>

{#if form?.message}
  <div class="card" style="border-color:#ffd08a; background:#fff8ed; margin-bottom:12px;">
    {form.message}
  </div>
{/if}

<div class="card" style="margin-bottom:12px;">
  <h3 style="margin:0 0 10px;">Create match</h3>
  <form method="POST" action="?/create" style="display:flex; gap:10px; flex-wrap:wrap; align-items:end;">
    <label style="min-width:240px;">
      <div class="muted">Season</div>
      <select name="season_id" bind:value={season_id} required style="min-width:240px;">
        {#each data.seasons as s}
          <option value={s.id}>{s.name}{s.is_active ? ' (active)' : ''}</option>
        {/each}
      </select>
    </label>

    <label style="min-width:240px;">
      <div class="muted">Ruleset</div>
      <select name="ruleset_id" bind:value={ruleset_id} required style="min-width:240px;">
        {#each data.rulesets as r}
          <option value={r.id}>{r.name}</option>
        {/each}
      </select>
    </label>

    <label>
      <div class="muted">Played at</div>
      <input name="played_at" type="datetime-local" bind:value={played_at} required />
    </label>

    <label style="min-width:200px;">
      <div class="muted">Table label (optional)</div>
      <input name="table_label" bind:value={table_label} placeholder="Table 1" />
    </label>

    <label style="width:120px;">
      <div class="muted">Game (optional)</div>
      <input name="game_number" type="number" min="1" step="1" bind:value={game_number} />
    </label>

    <label style="width:120px;">
      <div class="muted">Tbl</div>
      <select name="table_mode" bind:value={table_mode}>
        <option value="A">A</option>
        <option value="M">M</option>
      </select>
    </label>

    <label style="width:120px;">
      <div class="muted">Ex</div>
      <input name="extra_sticks" type="number" min="0" step="1" bind:value={extra_sticks} />
    </label>

    <button class="btn primary" type="submit">Create draft</button>
  </form>

  {#if data.rulesets.length === 0}
    <div class="muted" style="margin-top:10px;">No rulesets found. Run the schema seed or create one in SQL.</div>
  {/if}
</div>

<div class="card">
  <h3 style="margin:0 0 10px;">Recent matches</h3>
  <div style="overflow:auto;">
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Match</th>
          <th style="width:80px;">Tbl</th>
          <th style="width:80px;">Game</th>
          <th style="width:80px;">Ex</th>
          <th style="width:120px;">Status</th>
          <th style="width:140px;"></th>
        </tr>
      </thead>
      <tbody>
        {#each data.recentMatches as m}
          <tr>
            <td>{fmtDateTime(m.played_at)}</td>
            <td>{m.table_label ?? m.id.slice(0,8)}</td>
            <td>{m.table_mode ?? ''}</td>
            <td>{m.game_number ?? ''}</td>
            <td>{m.extra_sticks ?? 0}</td>
            <td>{m.status}</td>
            <td>
              <a class="btn" href={`/admin/match/${m.id}`} style="text-decoration:none;">Open</a>
              {#if m.status === 'final'}
                <a class="btn" href={`/match/${m.id}`} style="text-decoration:none; margin-left:6px;">Public</a>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>
