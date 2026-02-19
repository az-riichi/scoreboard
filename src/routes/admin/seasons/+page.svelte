<script lang="ts">
  export let data: any;
  export let form: any;

  let name = '';
  let start_date = '';
  let end_date = '';
  let is_active = false;
</script>

<div class="card" style="margin-bottom:12px;">
  <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:end;">
    <div>
      <div style="font-size:1.1rem; font-weight:650;">Seasons</div>
      <div class="muted">Create and manage seasons.</div>
    </div>
    <a class="btn" href="/admin" style="text-decoration:none;">Back</a>
  </div>
</div>

{#if form?.message}
  <div class="card" style="border-color:#c7f0c2; background:#f2fff0; margin-bottom:12px;">
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
