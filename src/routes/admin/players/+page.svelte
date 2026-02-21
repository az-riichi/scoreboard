<script lang="ts">
  export let data: any;
  export let form: any;

  let players: any[] = [];
  let activeEditId: string | null = null;

  $: players = data.players ?? [];
  $: activeEditId = form?.edit_id ?? data.editId ?? null;

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
      <div class="muted">Register new players</div>
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
  <h3 style="margin:0 0 10px;">Create player</h3>
  <form method="POST" action="?/create" style="display:flex; gap:10px; flex-wrap:nowrap; align-items:end; overflow-x:auto; padding-bottom:2px;">
    <label style="width:200px; flex:0 1 auto;">
      <div class="muted">Nickname</div>
      <input name="display_name" bind:value={display_name} placeholder="Optional" />
    </label>
    <label style="width:200px; flex:0 1 auto;">
      <div class="muted">First name</div>
      <input name="real_first_name" bind:value={real_first_name} placeholder="Optional" />
    </label>
    <label style="width:200px; flex:0 1 auto;">
      <div class="muted">Last name</div>
      <input name="real_last_name" bind:value={real_last_name} placeholder="Optional" />
    </label>
    <label style="width:200px; flex:0 0 auto;">
      <div class="muted">Name display</div>
      <div style="display:flex; gap:12px; flex-wrap:nowrap; align-items:center; min-height:40px;">
        <label style="display:flex; gap:8px; align-items:center; padding:8px 0;">
          <input name="show_display_name" type="checkbox" bind:checked={show_display_name} />
          <span class="muted">Nick</span>
        </label>
        <label style="display:flex; gap:8px; align-items:center; padding:8px 0;">
          <input name="show_real_first_name" type="checkbox" bind:checked={show_real_first_name} />
          <span class="muted">First</span>
        </label>
        <label style="display:flex; gap:8px; align-items:center; padding:8px 0;">
          <input name="show_real_last_name" type="checkbox" bind:checked={show_real_last_name} />
          <span class="muted">Last</span>
        </label>
      </div>
    </label>
    <button class="btn primary" type="submit" style="flex:0 0 auto; white-space:nowrap; margin-left: auto">Create</button>
  </form>
</div>

<div class="card">
  <h3 style="margin:0 0 10px;">Roster</h3>
  <div style="overflow:auto;">
    <table>
      <thead>
        <tr>
          <th>Public Name</th>
          <th>Nickname</th>
          <th>First</th>
          <th>Last</th>
          <th>Visible</th>
          <th style="width:120px;">Active</th>
          <th style="width:120px;"></th>
        </tr>
      </thead>
      <tbody>
        {#each data.players as p}
          {#if activeEditId === p.id}
            <tr>
              <td colspan="7">
                <form method="POST" action="?/update" style="display:flex; gap:10px; flex-wrap:wrap; align-items:end; margin-top:2px; padding-bottom:2px;">
                  <input type="hidden" name="player_id" value={p.id} />

                  <label style="width:200px; flex:0 1 auto;">
                    <div class="muted">Nickname</div>
                    <input name="display_name" value={p.display_name ?? ''} placeholder="Optional" />
                  </label>
                  <label style="width:200px; flex:0 1 auto;">
                    <div class="muted">First name</div>
                    <input name="real_first_name" value={p.real_first_name ?? ''} placeholder="Optional" />
                  </label>
                  <label style="width:200px; flex:0 1 auto;">
                    <div class="muted">Last name</div>
                    <input name="real_last_name" value={p.real_last_name ?? ''} placeholder="Optional" />
                  </label>

                  <label style="width:200px; flex:0 0 auto;">
                    <div class="muted">Name display</div>
                    <div style="display:flex; gap:12px; flex-wrap:nowrap; align-items:center; min-height:40px;">
                      <label style="display:flex; gap:8px; align-items:center; padding:8px 0;">
                        <input name="show_display_name" type="checkbox" checked={p.show_display_name} />
                        <span class="muted">Nick</span>
                      </label>
                      <label style="display:flex; gap:8px; align-items:center; padding:8px 0;">
                        <input name="show_real_first_name" type="checkbox" checked={p.show_real_first_name} />
                        <span class="muted">First</span>
                      </label>
                      <label style="display:flex; gap:8px; align-items:center; padding:8px 0;">
                        <input name="show_real_last_name" type="checkbox" checked={p.show_real_last_name} />
                        <span class="muted">Last</span>
                      </label>
                    </div>
                  </label>

                  <label style="display:flex; gap:8px; align-items:center; padding:8px 0; flex:0 0 auto;">
                    <input name="is_active" type="checkbox" checked={p.is_active} />
                    <span class="muted">Active</span>
                  </label>

                  <div style="display:flex; gap:8px; align-items:center; justify-content:flex-end; flex:1 0 100%;">
                    <a class="btn" href="/admin/players" style="text-decoration:none;">Cancel</a>
                    <button class="btn primary" type="submit" style="white-space:nowrap;">Save</button>
                  </div>
                </form>
              </td>
            </tr>
          {:else}
            <tr>
              <td>
                <a href={`/player/${p.id}`} style="text-decoration:none;">
                  {p.public_name_primary}
                  {#if p.public_name_secondary}
                    <span class="muted" style="margin-left:6px;">({p.public_name_secondary})</span>
                  {/if}
                </a>
              </td>
              <td>{p.display_name ?? ''}</td>
              <td>{p.real_first_name ?? ''}</td>
              <td>{p.real_last_name ?? ''}</td>
              <td>{p.show_display_name ? 'display' : ''}{p.show_real_first_name ? (p.show_display_name ? ' + first' : 'first') : ''}{p.show_real_last_name ? ' + last' : ''}</td>
              <td>{p.is_active ? 'Yes' : 'No'}</td>
              <td style="align-items: end">
                <a class="btn" href={`/admin/players?edit=${p.id}`} style="text-decoration:none">Edit</a>
              </td>
            </tr>
          {/if}
        {/each}
        {#if data.players.length === 0}
          <tr><td colspan="7" class="muted">No players yet.</td></tr>
        {/if}
      </tbody>
    </table>
  </div>
</div>
