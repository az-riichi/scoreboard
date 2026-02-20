<script lang="ts">
  import { fmtDateTime } from '$lib/ui';
  export let data: any;
  export let form: any;

  function nowLocalDatetime() {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  let season_id = data.activeSeason ?? '';
  let ruleset_id = data.defaultRules ?? '';
  let played_at = nowLocalDatetime();
  let table_mode = 'A';
  let extra_sticks = 0;
  let notes = '';
</script>

<div class="card" style="margin-bottom:12px;">
  <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:end;">
    <div>
      <div style="font-size:1.1rem; font-weight:650;">Matches</div>
      <div class="muted">Enter and review match results</div>
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
  <div class="muted" style="margin-bottom:10px;">Game # and table label are auto-generated from date + table type.</div>
  <form method="POST" action="?/create" style="display:grid; gap:10px;">
    <div style="display:grid; gap:10px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));">
      <label style="display:grid; gap:4px;">
        <div class="muted">Season</div>
        <select name="season_id" bind:value={season_id} required>
          {#each data.seasons as s}
            <option value={s.id}>{s.name}{s.is_active ? ' (active)' : ''}</option>
          {/each}
        </select>
      </label>

      <label style="display:grid; gap:4px;">
        <div class="muted">Ruleset</div>
        <select name="ruleset_id" bind:value={ruleset_id} required>
          {#each data.rulesets as r}
            <option value={r.id}>{r.name}</option>
          {/each}
        </select>
      </label>

      <label style="display:grid; gap:4px;">
        <div class="muted">Played at</div>
        <input name="played_at" type="datetime-local" bind:value={played_at} required />
      </label>
    </div>

    <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:end;">
      <label style="width:70px; display:grid; gap:4px;">
        <div class="muted">Tbl type</div>
        <select name="table_mode" bind:value={table_mode}>
          <option value="A">A</option>
          <option value="M">M</option>
        </select>
      </label>

      <label style="display:grid; gap:4px;">
        <div class="muted">Extra</div>
        <input style="width:50px" name="extra_sticks" type="number" min="0" step="1000" bind:value={extra_sticks} />
      </label>

      <label style="min-width:150px; flex:0 1 500px; display:grid; gap:4px;">
        <div class="muted">Notes (optional)</div>
        <input name="notes" bind:value={notes} placeholder="Match notes" />
      </label>

      <button class="btn primary" type="submit" style="margin-left: auto;">Create draft</button>
    </div>
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
          <th style="width:90px;">Game</th>
          <th style="width:80px;">Ex</th>
          <th style="width:120px;">Status</th>
          <th style="width:300px;"></th>
        </tr>
      </thead>
      <tbody>
        {#each data.recentMatches as m}
          <tr>
            <td>{fmtDateTime(m.played_at)}</td>
            <td>{m.table_mode ?? ''}{m.game_number ?? ''}</td>
            <td>{m.extra_sticks ?? 0}</td>
            <td>{m.status}</td>
            <td>
              <div style="display:flex; gap:6px; flex-wrap:wrap;">
                <a class="btn" href={`/admin/match/${m.id}`} style="text-decoration:none;">Open</a>
                {#if m.status === 'final'}
                  <a class="btn" href={`/match/${m.id}`} style="text-decoration:none;">Public</a>
                {/if}
                <form method="POST" action="?/delete" style="margin:0;" on:submit={(e) => { if (!confirm('Delete this game? This cannot be undone.')) e.preventDefault(); }}>
                  <input type="hidden" name="match_id" value={m.id} />
                  <button class="btn" type="submit">Delete</button>
                </form>
              </div>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>
