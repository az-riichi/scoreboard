<script lang="ts">
  import { enhance } from '$app/forms';
  import { clickableRow } from '$lib/clickable-row';
  import { hasAdminPermission } from '$lib/permissions';

  export let data: any;
  export let form: any;

  let players: any[] = [];
  let activeEditId: string | null = form?.edit_id ?? data.editId ?? null;
  let canAddPlayers = false;
  let canEditPlayers = false;
  let canRemovePlayers = false;
  let canManagePlayerAccounts = false;
  let canOpenEditor = false;
  let showActions = false;
  let rosterColumnCount = 6;

  $: players = data.players ?? [];
  $: canAddPlayers = hasAdminPermission(data.adminAccess, 'add_players');
  $: canEditPlayers = hasAdminPermission(data.adminAccess, 'edit_players');
  $: canRemovePlayers = hasAdminPermission(data.adminAccess, 'remove_players');
  $: canManagePlayerAccounts = hasAdminPermission(data.adminAccess, 'manage_player_accounts');
  $: canOpenEditor = canEditPlayers || canManagePlayerAccounts;
  $: showActions = canOpenEditor || canRemovePlayers;
  $: rosterColumnCount = 6 + (canManagePlayerAccounts ? 1 : 0) + (showActions ? 1 : 0);

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
      <div class="muted">View and manage the player roster</div>
    </div>
    <a class="btn" href="/admin" style="text-decoration:none;">Back</a>
  </div>
</div>

{#if form?.message}
  <div class="card alert" class:alert-success={form.ok !== false} class:alert-error={form.ok === false}>
    {form.message}
  </div>
{/if}

{#if canAddPlayers}
  <div class="card" style="margin-bottom:12px;">
    <h3 style="margin:0 0 10px;">Create player</h3>
    <form method="POST" action="?/create" use:enhance style="display:flex; gap:10px; flex-wrap:nowrap; align-items:end; overflow-x:auto; padding-bottom:2px;">
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
{/if}

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
          {#if canManagePlayerAccounts}
            <th style="min-width:240px;">Claimed Account</th>
          {/if}
          <th style="width:120px;">Active</th>
          {#if showActions}
            <th style="min-width:120px;">Actions</th>
          {/if}
        </tr>
      </thead>
      <tbody>
        {#each players as p (p.id)}
          {#if activeEditId === p.id && canOpenEditor}
            <tr>
              <td colspan={rosterColumnCount}>
                {#if canEditPlayers}
                  <h4 style="margin:2px 0 10px;">Player details</h4>
                  <form method="POST" action="?/update" use:enhance style="display:flex; gap:10px; flex-wrap:wrap; align-items:end; padding-bottom:2px;">
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

                    <button class="btn primary" type="submit" style="white-space:nowrap; margin-left:auto;">Save details</button>
                  </form>
                {/if}

                {#if canManagePlayerAccounts}
                  <div style="margin-top:10px; padding-top:10px; border-top:1px solid var(--table-border);">
                    <h4 style="margin:0 0 10px;">Player account</h4>
                  <form method="POST" action="?/setClaim" use:enhance style="display:flex; gap:10px; flex-wrap:wrap; align-items:end;">
                    <input type="hidden" name="player_id" value={p.id} />

                    <label style="min-width:320px; flex:1 1 360px;">
                      <div class="muted">Linked account</div>
                      <select name="auth_user_id" style="width:100%;">
                        <option value="">Unclaimed</option>
                        {#each data.profiles as acct}
                          <option value={acct.id} selected={p.linked_auth_user_id === acct.id}>
                            {(acct.email ?? '(no email)') + ' - ' + acct.id.slice(0, 8) + (acct.is_admin ? ' [admin]' : '')}
                          </option>
                        {/each}
                      </select>
                    </label>

                    <button class="btn" type="submit" style="white-space:nowrap;">Link account</button>
                  </form>
                  </div>
                {/if}

                <div style="display:flex; gap:8px; align-items:center; justify-content:flex-end; margin-top:10px; padding-top:10px; border-top:1px solid var(--table-border);">
                  {#if canRemovePlayers}
                    <form method="POST" action="?/setActive" use:enhance>
                      <input type="hidden" name="player_id" value={p.id} />
                      <input type="hidden" name="is_active" value={p.is_active ? 'false' : 'true'} />
                      <button class="btn" type="submit">{p.is_active ? 'Deactivate' : 'Reactivate'}</button>
                    </form>
                  {/if}
                  <button class="btn" type="button" on:click={() => (activeEditId = null)}>Close</button>
                </div>
              </td>
            </tr>
          {:else}
            <tr use:clickableRow={`/player/${p.id}`}>
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
              {#if canManagePlayerAccounts}
                <td>
                  {#if p.linked_auth_user_id}
                    <div>
                      {p.linked_profile_email ?? '(no email)'} - {p.linked_auth_user_id.slice(0, 8)}
                      {#if p.linked_profile_is_admin}
                        <span class="muted"> [admin]</span>
                      {/if}
                    </div>
                  {:else}
                    <span class="muted">Unclaimed</span>
                  {/if}
                </td>
              {/if}
              <td>{p.is_active ? 'Yes' : 'No'}</td>
              {#if showActions}
                <td>
                  <div style="display:flex; gap:8px; align-items:center; justify-content:flex-end;">
                    {#if canOpenEditor}
                      <button class="btn" type="button" on:click={() => (activeEditId = p.id)}>
                        {canEditPlayers && canManagePlayerAccounts ? 'Manage' : canEditPlayers ? 'Edit' : 'Account'}
                      </button>
                    {/if}
                    {#if canRemovePlayers}
                      <form method="POST" action="?/setActive" use:enhance>
                        <input type="hidden" name="player_id" value={p.id} />
                        <input type="hidden" name="is_active" value={p.is_active ? 'false' : 'true'} />
                        <button class="btn" type="submit">{p.is_active ? 'Deactivate' : 'Reactivate'}</button>
                      </form>
                    {/if}
                  </div>
                </td>
              {/if}
            </tr>
          {/if}
        {/each}
        {#if players.length === 0}
          <tr><td colspan={rosterColumnCount} class="muted">No players yet.</td></tr>
        {/if}
      </tbody>
    </table>
  </div>
</div>
