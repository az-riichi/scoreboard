<script lang="ts">
  import { enhance } from '$app/forms';
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
  let rosterQuery = '';

  $: players = data.players ?? [];
  $: canAddPlayers = hasAdminPermission(data.adminAccess, 'add_players');
  $: canEditPlayers = hasAdminPermission(data.adminAccess, 'edit_players');
  $: canRemovePlayers = hasAdminPermission(data.adminAccess, 'remove_players');
  $: canManagePlayerAccounts = hasAdminPermission(data.adminAccess, 'manage_player_accounts');
  $: canOpenEditor = canEditPlayers || canManagePlayerAccounts || canRemovePlayers;
  $: normalizedQuery = rosterQuery.trim().toLocaleLowerCase();
  $: visiblePlayers = normalizedQuery
    ? players.filter((p) => rosterSearchText(p).includes(normalizedQuery))
    : players;

  let display_name = '';
  let real_first_name = '';
  let real_last_name = '';
  let show_display_name = true;
  let show_real_first_name = false;
  let show_real_last_name = false;

  function rosterSearchText(p: any) {
    return [
      p.public_name_primary,
      p.public_name_secondary,
      p.display_name,
      p.real_first_name,
      p.real_last_name,
      canManagePlayerAccounts ? p.linked_profile_email : null
    ]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase();
  }

  // Blank when the public name already says the same thing.
  function otherNames(p: any) {
    const realName = [p.real_first_name, p.real_last_name].filter(Boolean).join(' ');
    const names = [realName, p.display_name].filter(Boolean);
    const publicNames = [p.public_name_primary, p.public_name_secondary];
    return names.every((name) => publicNames.includes(name)) ? '' : names.join(' · ');
  }
</script>

<style>
  /* Three names, the display choices, then the action: one row when wide, stacked on phones. */
  .player-form {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr)) auto auto;
    gap: 10px 12px;
    align-items: end;
  }

  .name-display {
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }

  .name-display legend {
    padding: 0;
  }

  .name-display__options {
    display: flex;
    flex-wrap: wrap;
    gap: 0 14px;
    margin-top: 4px;
  }

  .roster-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 10px 14px;
  }

  .roster-search {
    flex: 0 1 280px;
    min-width: 0;
    box-sizing: border-box;
  }

  .roster {
    margin: 12px 0 0;
    padding: 0;
    list-style: none;
  }

  .roster-row,
  .roster-columns {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.25fr) 96px 92px;
    gap: 4px 14px;
    align-items: center;
    padding: 9px 8px;
  }

  .roster-columns {
    border-bottom: 1px solid var(--table-border);
    color: var(--table-head);
    font-size: var(--type-label);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .roster-item {
    border-bottom: 1px solid var(--table-row);
  }

  .roster-item:last-child {
    border-bottom: 0;
  }

  .roster-item.is-open {
    background: var(--row-hover);
  }

  .roster-item.is-inactive .roster-player,
  .roster-item.is-inactive .roster-names,
  .roster-item.is-inactive .roster-account {
    opacity: 0.6;
  }

  .roster-player {
    min-width: 0;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .roster-player a {
    text-decoration: none;
  }

  .roster-player a:hover {
    color: var(--accent);
  }

  .roster-player .muted {
    font-weight: 400;
  }

  .roster-names,
  .roster-account {
    min-width: 0;
    color: var(--muted);
    font-size: var(--type-small);
    overflow-wrap: anywhere;
  }

  .roster-account.is-linked {
    color: var(--text);
  }

  .roster-action {
    justify-self: end;
  }

  .roster-empty {
    padding: 14px 8px;
  }

  .roster-editor {
    display: grid;
    gap: 14px;
    padding: 4px 8px 14px;
  }

  .editor-section {
    display: grid;
    gap: 10px;
    padding-top: 12px;
    border-top: 1px solid var(--table-border);
  }

  .editor-title {
    margin: 0;
    color: var(--table-head);
    font-size: var(--type-label);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .account-form {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 10px 12px;
    align-items: end;
  }

  .editor-footer {
    display: flex;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 8px;
    padding-top: 12px;
    border-top: 1px solid var(--table-border);
  }

  @media (max-width: 900px) {
    .player-form {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .name-display {
      grid-column: span 2;
    }

    .player-form > .btn {
      justify-self: end;
    }
  }

  @media (max-width: 700px) {
    .roster-columns {
      display: none;
    }

    /* Details stack beside Manage. Most players are active, so only the exception gets a tag. */
    .roster-row {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 2px 12px;
      padding: 10px 0;
    }

    .roster-row > * {
      grid-column: 1;
    }

    .roster-names:empty,
    .roster-status.is-active {
      display: none;
    }

    .roster-row > .roster-action {
      grid-column: 2;
      grid-row: 1 / span 4;
    }

    .roster-editor {
      padding: 2px 0 14px;
    }

    .roster-item.is-open {
      background: none;
    }

    .account-form {
      grid-template-columns: minmax(0, 1fr);
    }

    .account-form > .btn {
      justify-self: stretch;
    }

    .editor-footer > * {
      flex: 1 1 0;
    }

    .editor-footer .btn {
      width: 100%;
    }
  }

  @media (max-width: 560px) {
    .player-form {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .player-form__nickname,
    .name-display,
    .player-form > .btn {
      grid-column: 1 / -1;
    }

    .player-form > .btn {
      justify-self: stretch;
    }

    .roster-search {
      flex: 1 1 100%;
    }
  }
</style>

<div class="card" style="margin-bottom:12px;">
  <div class="card-head">
    <div>
      <div class="title-row">
        <span class="led-tag" lang="ja" aria-hidden="true">雀士</span>
        <h1 class="page-title">Players</h1>
      </div>
    </div>
    <a class="btn" href="/admin">Back</a>
  </div>
</div>

{#if form?.message}
  <div class="card alert" class:alert-success={form.ok !== false} class:alert-error={form.ok === false}>
    {form.message}
  </div>
{/if}

{#if canAddPlayers}
  <div class="card" style="margin-bottom:12px;">
    <h2 class="card-title" style="margin-bottom:12px;">Create player</h2>
    <form method="POST" action="?/create" use:enhance class="player-form">
      <label class="field player-form__nickname">
        <span class="muted">Nickname</span>
        <input name="display_name" bind:value={display_name} placeholder="Optional" />
      </label>
      <label class="field">
        <span class="muted">First name</span>
        <input name="real_first_name" bind:value={real_first_name} placeholder="Optional" />
      </label>
      <label class="field">
        <span class="muted">Last name</span>
        <input name="real_last_name" bind:value={real_last_name} placeholder="Optional" />
      </label>
      <fieldset class="name-display">
        <legend class="muted">Name display</legend>
        <div class="name-display__options">
          <label class="check-field">
            <input name="show_display_name" type="checkbox" bind:checked={show_display_name} />
            <span class="muted">Nick</span>
          </label>
          <label class="check-field">
            <input name="show_real_first_name" type="checkbox" bind:checked={show_real_first_name} />
            <span class="muted">First</span>
          </label>
          <label class="check-field">
            <input name="show_real_last_name" type="checkbox" bind:checked={show_real_last_name} />
            <span class="muted">Last</span>
          </label>
        </div>
      </fieldset>
      <button class="btn primary" type="submit">Create</button>
    </form>
  </div>
{/if}

<div class="card">
  <div class="roster-head">
    <h2 class="card-title">Roster</h2>
    <input
      class="roster-search"
      type="search"
      bind:value={rosterQuery}
      placeholder="Search {players.length} players"
      aria-label="Search players"
    />
  </div>

  <div class="roster-columns" aria-hidden="true">
    <span>Public name</span>
    <span>Other names</span>
    <span>{canManagePlayerAccounts ? 'Claimed account' : ''}</span>
    <span>Status</span>
    <span></span>
  </div>

  <ul class="roster" style="margin-top:0;">
    {#each visiblePlayers as p (p.id)}
      {@const isOpen = activeEditId === p.id && canOpenEditor}
      <li class="roster-item" class:is-open={isOpen} class:is-inactive={!p.is_active}>
        <div class="roster-row">
          <div class="roster-player">
            <a href={`/player/${p.id}`}>
              {p.public_name_primary}
              {#if p.public_name_secondary}
                <span class="muted">({p.public_name_secondary})</span>
              {/if}
            </a>
          </div>
          <div class="roster-names">{otherNames(p)}</div>
          <div class="roster-account" class:is-linked={p.linked_auth_user_id && canManagePlayerAccounts}>
            {#if canManagePlayerAccounts}
              {#if p.linked_auth_user_id}
                {p.linked_profile_email ?? p.linked_auth_user_id.slice(0, 8)}
                {#if p.linked_profile_is_admin}
                  <span class="muted">[admin]</span>
                {/if}
              {:else}
                Unclaimed
              {/if}
            {/if}
          </div>
          <div class="roster-status" class:is-active={p.is_active}>
            <span class="tag">
              <span class="led-dot" class:is-on={p.is_active} aria-hidden="true"></span>
              {p.is_active ? 'Active' : 'Inactive'}
            </span>
          </div>
          {#if canOpenEditor}
            <button
              class="btn roster-action"
              type="button"
              aria-expanded={isOpen}
              on:click={() => (activeEditId = isOpen ? null : p.id)}
            >
              {isOpen ? 'Close' : 'Manage'}
            </button>
          {/if}
        </div>

        {#if isOpen}
          <div class="roster-editor">
            {#if canEditPlayers}
              <div class="editor-section">
                <h3 class="editor-title">Player details</h3>
                <form method="POST" action="?/update" use:enhance class="player-form">
                  <input type="hidden" name="player_id" value={p.id} />
                  <label class="field player-form__nickname">
                    <span class="muted">Nickname</span>
                    <input name="display_name" value={p.display_name ?? ''} placeholder="Optional" />
                  </label>
                  <label class="field">
                    <span class="muted">First name</span>
                    <input name="real_first_name" value={p.real_first_name ?? ''} placeholder="Optional" />
                  </label>
                  <label class="field">
                    <span class="muted">Last name</span>
                    <input name="real_last_name" value={p.real_last_name ?? ''} placeholder="Optional" />
                  </label>
                  <fieldset class="name-display">
                    <legend class="muted">Name display</legend>
                    <div class="name-display__options">
                      <label class="check-field">
                        <input name="show_display_name" type="checkbox" checked={p.show_display_name} />
                        <span class="muted">Nick</span>
                      </label>
                      <label class="check-field">
                        <input name="show_real_first_name" type="checkbox" checked={p.show_real_first_name} />
                        <span class="muted">First</span>
                      </label>
                      <label class="check-field">
                        <input name="show_real_last_name" type="checkbox" checked={p.show_real_last_name} />
                        <span class="muted">Last</span>
                      </label>
                    </div>
                  </fieldset>
                  <button class="btn primary" type="submit">Save details</button>
                </form>
              </div>
            {/if}

            {#if canManagePlayerAccounts}
              <div class="editor-section">
                <h3 class="editor-title">Player account</h3>
                <form method="POST" action="?/setClaim" use:enhance class="account-form">
                  <input type="hidden" name="player_id" value={p.id} />
                  <label class="field">
                    <span class="muted">Linked account</span>
                    <select name="auth_user_id">
                      <option value="">Unclaimed</option>
                      {#each data.profiles as acct}
                        <option value={acct.id} selected={p.linked_auth_user_id === acct.id}>
                          {(acct.email ?? '(no email)') + ' - ' + acct.id.slice(0, 8) + (acct.is_admin ? ' [admin]' : '')}
                        </option>
                      {/each}
                    </select>
                  </label>
                  <button class="btn" type="submit">Link account</button>
                </form>
              </div>
            {/if}

            <div class="editor-footer">
              {#if canRemovePlayers}
                <form method="POST" action="?/setActive" use:enhance>
                  <input type="hidden" name="player_id" value={p.id} />
                  <input type="hidden" name="is_active" value={p.is_active ? 'false' : 'true'} />
                  <button class="btn" type="submit">{p.is_active ? 'Deactivate' : 'Reactivate'}</button>
                </form>
              {/if}
              <button class="btn" type="button" on:click={() => (activeEditId = null)}>Close</button>
            </div>
          </div>
        {/if}
      </li>
    {/each}
    {#if visiblePlayers.length === 0}
      <li class="roster-empty muted">{players.length === 0 ? 'No players yet.' : 'No players match that search.'}</li>
    {/if}
  </ul>
</div>
