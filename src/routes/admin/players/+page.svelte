<script lang="ts">
  export let data: any;
  export let form: any;

  let display_name = '';
</script>

<div class="card" style="margin-bottom:12px;">
  <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:end;">
    <div>
      <div style="font-size:1.1rem; font-weight:650;">Players</div>
      <div class="muted">Register players for the club.</div>
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
  <h3 style="margin:0 0 10px;">Create player</h3>
  <form method="POST" action="?/create" style="display:flex; gap:10px; flex-wrap:wrap; align-items:end;">
    <label style="min-width:260px;">
      <div class="muted">Display name</div>
      <input name="display_name" bind:value={display_name} required />
    </label>
    <button class="btn primary" type="submit">Create</button>
  </form>
</div>

<div class="card">
  <h3 style="margin:0 0 10px;">Roster</h3>
  <div style="overflow:auto;">
    <table>
      <thead>
        <tr>
          <th>Player</th>
          <th style="width:120px;">Active</th>
          <th style="width:120px;"></th>
        </tr>
      </thead>
      <tbody>
        {#each data.players as p}
          <tr>
            <td><a href={`/player/${p.id}`} style="text-decoration:none;">{p.display_name}</a></td>
            <td>{p.is_active ? 'Yes' : 'No'}</td>
            <td></td>
          </tr>
        {/each}
        {#if data.players.length === 0}
          <tr><td colspan="3" class="muted">No players yet.</td></tr>
        {/if}
      </tbody>
    </table>
  </div>
</div>
