<script lang="ts">
  import {
    asText, actionTypeLabel, statusLabel, statusTone, formatIssued,
    formatDay, isEffective, expiryLabel, sourceLabel
  } from '$lib/discipline-ui';
  import { hasAnyAdminPermission } from '$lib/permissions';

  export let data: any;
  export let form: any;

  let selectedPlayerId = String(data.selectedPlayerId ?? '');
  let action_type = 'strike';
  let reason = '';
  let match_id = '';

  $: selectedPlayerId = String(data.selectedPlayerId ?? '');
  $: players = data.players ?? [];
  $: matches = data.matches ?? [];
  $: selectedPlayer = data.selectedPlayer ?? null;
  $: summary = data.summary ?? null;
  $: actions = data.actions ?? [];
  $: currentAction = summary?.currentAction ?? null;
  $: canOpenAdminMatches = hasAnyAdminPermission(data.adminAccess, [
    'add_matches',
    'remove_matches',
    'manage_match_penalties'
  ]);

  function confirmIssue(event: SubmitEvent) {
    const playerLabel = selectedPlayer?.label ?? 'this player';
    const actionLabel = actionTypeLabel(action_type).toLowerCase();
    if (!confirm(`Issue a ${actionLabel} to ${playerLabel}?`)) event.preventDefault();
  }
</script>

<style>
  .page-heading,
  .section-heading {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }

  .page-heading .muted,
  .section-heading .muted {
    margin-top: 4px;
  }

  .player-form,
  .issue-form {
    display: grid;
    gap: 10px;
    margin-top: 12px;
  }

  .player-form {
    grid-template-columns: minmax(240px, 1fr) auto;
    align-items: end;
  }

  .issue-grid {
    display: grid;
    grid-template-columns: minmax(180px, 0.65fr) minmax(240px, 1fr);
    gap: 10px;
  }

  .field {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  .field > :global(input),
  .field > :global(select),
  .field > :global(textarea) {
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
  }

  .summary-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    margin-top: 12px;
  }

  .summary-value {
    justify-self: start;
  }

  .current-action {
    margin-top: 10px;
    border-left: 4px solid var(--alert-warning-border);
    box-shadow: none;
  }

  .current-action.status-ban-border {
    border-left-color: var(--alert-error-border);
  }

  .action-details {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    margin-top: 10px;
  }

  .action-details > div {
    min-width: 0;
  }

  .history-wrap {
    margin-top: 12px;
    overflow-x: auto;
  }

  .history-wrap table {
    min-width: 980px;
  }

  .action-name {
    display: flex;
    align-items: center;
    gap: 7px;
    flex-wrap: wrap;
    font-weight: 650;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .history-row-revoked {
    opacity: 0.72;
  }

  .reason-cell {
    min-width: 220px;
    max-width: 360px;
    overflow-wrap: anywhere;
  }

  .date-stack {
    display: grid;
    gap: 3px;
    min-width: 170px;
  }

  .revoke-control {
    position: relative;
  }

  .revoke-control > summary {
    list-style: none;
  }

  .revoke-control > summary::-webkit-details-marker {
    display: none;
  }

  .revoke-form {
    display: grid;
    gap: 8px;
    width: min(320px, calc(100vw - 64px));
    margin-top: 8px;
    padding: 10px;
    border: 1px solid var(--card-border);
    border-radius: 10px;
    background: var(--card-bg);
    box-shadow: var(--raised-shadow);
  }

  .revoke-form input,
  .revoke-form textarea {
    width: 100%;
    box-sizing: border-box;
  }

  .empty-state {
    padding: 24px 14px;
    text-align: center;
  }

  @media (max-width: 760px) {
    .player-form,
    .issue-grid,
    .summary-grid,
    .action-details {
      grid-template-columns: 1fr;
    }

    .player-form .btn,
    .issue-form > .btn {
      width: 100%;
    }
  }
</style>

<div class="card" style="margin-bottom:12px;">
  <div class="page-heading">
    <div>
      <div class="title-row">
        <span class="led-tag" lang="ja" aria-hidden="true">処分</span>
        <h1 class="page-title">Discipline management</h1>
      </div>
      <div class="muted">Issue, review, and revoke private player discipline actions</div>
    </div>
    <a class="btn" href="/admin">Back</a>
  </div>
</div>

{#if form?.message}
  <div class="card alert" class:alert-success={form.ok !== false} class:alert-error={form.ok === false} role="status">
    {form.message}
  </div>
{/if}

<div class="card" style="margin-bottom:12px;">
  <h2 class="card-title">Choose a player</h2>
  <form method="GET" class="player-form">
    <label class="field">
      <span class="muted">Player</span>
      <select name="player" bind:value={selectedPlayerId} required aria-label="Player to manage">
        <option value="" disabled>Select a player</option>
        {#each players as player}
          <option value={player.id}>{player.label}</option>
        {/each}
      </select>
    </label>
    <button class="btn" type="submit" disabled={players.length === 0}>Review player</button>
  </form>
  {#if players.length === 0}
    <div class="muted" style="margin-top:10px;">No players are available.</div>
  {/if}
</div>

{#if selectedPlayer}
  <div class="card" style="margin-bottom:12px;">
    <div class="section-heading">
      <div>
        <h2 class="card-title title-plain">{selectedPlayer.label}</h2>
        <div class="muted">Current discipline summary</div>
      </div>
      <span class={`status-badge ${statusTone(summary?.status)}`}>{statusLabel(summary?.status)}</span>
    </div>

    <div class="summary-grid">
      <div class="stat-tile">
        <div class="stat-label">Active strikes</div>
        <span class="led led-md summary-value" class:led-amber={(summary?.activeStrikeCount ?? 0) > 0}>{summary?.activeStrikeCount ?? 0}</span>
      </div>
      <div class="stat-tile">
        <div class="stat-label">Suspensions issued</div>
        <span class="led led-md summary-value" class:led-amber={(summary?.suspensionCount ?? 0) > 0}>{summary?.suspensionCount ?? 0}</span>
      </div>
      <div class="stat-tile">
        <div class="stat-label">Current status</div>
        <span class={`status-badge summary-value ${statusTone(summary?.status)}`}>{statusLabel(summary?.status)}</span>
      </div>
    </div>

    {#if currentAction}
      <div class="card current-action" class:status-ban-border={asText(currentAction.action_type).toLowerCase() === 'ban'}>
        <div class="action-name">
          Current {actionTypeLabel(currentAction)}
          <span class={`status-badge ${statusTone(currentAction.action_type)}`}>Effective</span>
        </div>
        <div class="action-details">
          <div>
            <div class="muted">Effective</div>
            <div>{formatDay(currentAction.effective_on ?? currentAction.issued_at)}</div>
          </div>
          <div>
            <div class="muted">Duration</div>
            <div>{expiryLabel(currentAction)}</div>
          </div>
          <div>
            <div class="muted">Reason</div>
            <div>{currentAction.reason || 'No reason recorded'}</div>
          </div>
        </div>
      </div>
    {:else}
      <div class="muted" style="margin-top:12px;">No suspension or ban is currently in effect.</div>
    {/if}
  </div>

  <div class="card" style="margin-bottom:12px;">
    <h2 class="card-title">Issue an action</h2>
    <div class="muted" style="margin-top:4px;">The issue time is recorded automatically in Arizona time.</div>

    <form method="POST" action={`?player=${encodeURIComponent(selectedPlayer.id)}&/issue`} class="issue-form" on:submit={confirmIssue}>
      <input type="hidden" name="player_id" value={selectedPlayer.id} />
      <div class="issue-grid">
        <label class="field">
          <span class="muted">Action</span>
          <select name="action_type" bind:value={action_type} required>
            <option value="strike">Strike</option>
            <option value="suspension">Suspension</option>
            <option value="ban">Ban</option>
          </select>
        </label>

        <label class="field">
          <span class="muted">Related match (optional)</span>
          <select name="match_id" bind:value={match_id}>
            <option value="">No linked match</option>
            {#each matches as match}
              <option value={match.id}>{match.label}</option>
            {/each}
          </select>
        </label>
      </div>

      <label class="field">
        <span class="muted">Reason</span>
        <textarea name="reason" bind:value={reason} rows="4" maxlength="2000" required placeholder="Describe why this action is being issued"></textarea>
      </label>

      <button class="btn primary" type="submit">Issue action</button>
    </form>
  </div>

  <div class="card">
    <div class="section-heading">
      <div>
        <h2 class="card-title">Action history</h2>
        <div class="muted">Effective, expired, and revoked records for this player</div>
      </div>
      <span class="muted">{actions.length} {actions.length === 1 ? 'record' : 'records'}</span>
    </div>

    <div class="history-wrap">
      <table>
        <caption class="sr-only">Discipline action history for {selectedPlayer.label}</caption>
        <thead>
          <tr>
            <th>Action</th>
            <th>Issued</th>
            <th>Effective period</th>
            <th>Reason / match</th>
            <th>Source</th>
            <th>Status / controls</th>
          </tr>
        </thead>
        <tbody>
          {#each actions as action}
            <tr class:history-row-revoked={!!action.revoked_at}>
              <td>
                <div class="action-name">
                  {actionTypeLabel(action)}
                  <span class={`status-badge ${statusTone(action.action_type)}`}>{actionTypeLabel(action)}</span>
                </div>
              </td>
              <td>{formatIssued(action.issued_at)}</td>
              <td>
                <div class="date-stack">
                  <span>From {formatDay(action.effective_on ?? action.issued_at)}</span>
                  <span class="muted">{expiryLabel(action)}</span>
                </div>
              </td>
              <td class="reason-cell">
                <div>{action.reason || 'No reason recorded'}</div>
                {#if action.match_id}
                  <div class="muted" style="margin-top:4px;">
                    Match:
                    {#if canOpenAdminMatches}
                      <a href={`/admin/match/${action.match_id}`}>{action.match_label ?? action.match_id.slice(0, 8)}</a>
                    {:else}
                      {action.match_label ?? action.match_id.slice(0, 8)}
                    {/if}
                  </div>
                {/if}
              </td>
              <td>{sourceLabel(action.source)}</td>
              <td>
                {#if action.revoked_at}
                  <div class="date-stack">
                    <span class="status-badge status-muted">Revoked</span>
                    <span class="muted">{formatIssued(action.revoked_at)}</span>
                    {#if action.revocation_reason}
                      <span>{action.revocation_reason}</span>
                    {/if}
                  </div>
                {:else}
                  <div class="date-stack">
                    <span class={`status-badge ${isEffective(action) ? statusTone(action.action_type) : 'status-muted'}`}>
                      {isEffective(action) ? 'Effective' : 'Expired'}
                    </span>
                    <details class="revoke-control">
                      <summary class="btn">Revoke</summary>
                      <form method="POST" action={`?player=${encodeURIComponent(selectedPlayer.id)}&/revoke`} class="revoke-form">
                        <input type="hidden" name="action_id" value={action.id} />
                        <input type="hidden" name="player_id" value={selectedPlayer.id} />
                        <label class="field">
                          <span class="muted">Revocation reason</span>
                          <textarea
                            name="revocation_reason"
                            rows="3"
                            maxlength="2000"
                            required
                            placeholder="Why is this being revoked?"
                            aria-label={`Reason for revoking this ${actionTypeLabel(action).toLowerCase()}`}
                          ></textarea>
                        </label>
                        <button class="btn danger" type="submit">Revoke action</button>
                      </form>
                    </details>
                  </div>
                {/if}
              </td>
            </tr>
          {/each}
          {#if actions.length === 0}
            <tr><td colspan="6" class="muted">No discipline actions have been recorded for this player.</td></tr>
          {/if}
        </tbody>
      </table>
    </div>
  </div>
{:else}
  <div class="card empty-state">
    <h2 class="card-title">Select a player to begin</h2>
    <div class="muted" style="margin-top:5px;">Their current status, complete action history, and management controls will appear here.</div>
  </div>
{/if}
