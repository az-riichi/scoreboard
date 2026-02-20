<script lang="ts">
  export let data: any;
  export let form: any;

  let display_name = '';
  let real_first_name = '';
  let real_last_name = '';
  let show_display_name = true;
  let show_real_first_name = false;
  let show_real_last_name = false;
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
      <input name="display_name" bind:value={display_name} placeholder="Optional nickname" />
    </label>
    <label style="min-width:220px;">
      <div class="muted">Real first name</div>
      <input name="real_first_name" bind:value={real_first_name} placeholder="Optional first name" />
    </label>
    <label style="min-width:220px;">
      <div class="muted">Real last name</div>
      <input name="real_last_name" bind:value={real_last_name} placeholder="Optional last name" />
    </label>
    <label style="display:flex; gap:8px; align-items:center; padding:8px 0;">
      <input name="show_display_name" type="checkbox" bind:checked={show_display_name} />
      <span class="muted">Show display</span>
    </label>
    <label style="display:flex; gap:8px; align-items:center; padding:8px 0;">
      <input name="show_real_first_name" type="checkbox" bind:checked={show_real_first_name} />
      <span class="muted">Show first</span>
    </label>
    <label style="display:flex; gap:8px; align-items:center; padding:8px 0;">
      <input name="show_real_last_name" type="checkbox" bind:checked={show_real_last_name} />
      <span class="muted">Show last</span>
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
          <th>Public Name</th>
          <th>Display</th>
          <th>First</th>
          <th>Last</th>
          <th>Visible</th>
          <th style="width:120px;">Active</th>
          <th style="width:120px;"></th>
        </tr>
      </thead>
      <tbody>
        {#each data.players as p}
          <tr>
            <td><a href={`/player/${p.id}`} style="text-decoration:none;">{p.public_name}</a></td>
            <td>{p.display_name ?? ''}</td>
            <td>{p.real_first_name ?? ''}</td>
            <td>{p.real_last_name ?? ''}</td>
            <td>{p.show_display_name ? 'display' : ''}{p.show_real_first_name ? (p.show_display_name ? ' + first' : 'first') : ''}{p.show_real_last_name ? ' + last' : ''}</td>
            <td>{p.is_active ? 'Yes' : 'No'}</td>
            <td></td>
          </tr>
        {/each}
        {#if data.players.length === 0}
          <tr><td colspan="7" class="muted">No players yet.</td></tr>
        {/if}
      </tbody>
    </table>
  </div>
</div>
