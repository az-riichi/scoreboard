<script lang="ts">
  import {
    asText, actionTypeLabel, statusLabel, statusTone, formatIssued,
    formatDay, isEffective, expiryLabel, sourceLabel
  } from '$lib/discipline-ui';

  export let data: any;

  $: player = data.player ?? null;
  $: summary = data.summary ?? null;
  $: actions = data.actions ?? [];
  $: currentAction = summary?.currentAction ?? null;
  $: effectiveActions = (() => {
    const effective = actions.filter((action: any) => isEffective(action));
    if (currentAction && !effective.some((action: any) => action.id === currentAction.id)) {
      effective.unshift(currentAction);
    }
    return effective;
  })();

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

  .summary-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    margin-top: 12px;
  }

  .summary-value {
    justify-self: start;
  }

  .effective-list {
    display: grid;
    gap: 10px;
    margin-top: 12px;
  }

  .effective-action {
    border-left: 4px solid var(--alert-warning-border);
    box-shadow: none;
  }

  .effective-action.action-ban {
    border-left-color: var(--alert-error-border);
  }

  .action-title {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .action-details {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    margin-top: 10px;
  }

  .reason {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--table-border);
    overflow-wrap: anywhere;
  }

  .history-wrap {
    margin-top: 12px;
    overflow-x: auto;
  }

  .history-wrap table {
    min-width: 900px;
  }

  .date-stack,
  .status-stack {
    display: grid;
    gap: 4px;
    min-width: 160px;
  }

  .reason-cell {
    min-width: 220px;
    max-width: 360px;
    overflow-wrap: anywhere;
  }

  .history-row-revoked {
    opacity: 0.72;
  }

  .empty-state {
    width: min(620px, 100%);
    margin: 0 auto;
    box-sizing: border-box;
    padding: 28px 18px;
    text-align: center;
  }

  @media (max-width: 720px) {
    .summary-grid,
    .action-details {
      grid-template-columns: 1fr;
    }
  }
</style>

<div class="card" style="margin-bottom:12px;">
  <div class="page-heading">
    <div>
      <div class="title-row">
        <span class="led-tag" lang="ja" aria-hidden="true">処分</span>
        <h1 class="page-title">My discipline status</h1>
      </div>
      <div class="muted">Your current competitive-play status and discipline record</div>
    </div>
    <span class="tag">Private to you and authorized club officials</span>
  </div>
</div>

{#if !player}
  <div class="card empty-state">
    <h2 class="card-title">No player profile is linked to this account</h2>
    <p class="muted" style="margin:8px 0 0;">
      Ask a club official to link your login to your player profile. Your discipline status will appear here once it is linked.
    </p>
  </div>
{:else}
  <div class="card" style="margin-bottom:12px;">
    <div class="section-heading">
      <div>
        <h2 class="card-title title-plain">{player.label}</h2>
        <div class="muted">Current status</div>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
        <span class={`status-badge ${statusTone(summary?.status)}`}>{statusLabel(summary?.status)}</span>
        <a class="btn" href={`/player/${player.id}`}>View profile</a>
      </div>
    </div>

    <div class="summary-grid">
      <div class="stat-tile">
        <div class="stat-label">Competitive play</div>
        {#if statusLabel(summary?.status) === 'Good standing'}
          <span class="led led-md led-pos summary-value">Allowed</span>
        {:else}
          <span class="led led-md led-neg summary-value">Restricted</span>
        {/if}
      </div>
      <div class="stat-tile">
        <div class="stat-label">Active strikes</div>
        <span class="led led-md summary-value" class:led-amber={(summary?.activeStrikeCount ?? 0) > 0}>{summary?.activeStrikeCount ?? 0}</span>
      </div>
      <div class="stat-tile">
        <div class="stat-label">Suspensions issued</div>
        <span class="led led-md summary-value" class:led-amber={(summary?.suspensionCount ?? 0) > 0}>{summary?.suspensionCount ?? 0}</span>
      </div>
    </div>
  </div>

  <section class="card" style="margin-bottom:12px;" aria-labelledby="current-actions-title">
    <div class="section-heading">
      <div>
        <h2 id="current-actions-title" class="card-title">Currently effective actions</h2>
        <div class="muted">End dates shown below are inclusive.</div>
      </div>
      <span class="muted">{effectiveActions.length} effective</span>
    </div>

    {#if effectiveActions.length > 0}
      <div class="effective-list">
        {#each effectiveActions as action}
          <article class="card effective-action" class:action-ban={asText(action.action_type).toLowerCase() === 'ban'}>
            <div class="action-title">
              {actionTypeLabel(action)}
              <span class={`status-badge ${statusTone(action.action_type)}`}>Effective</span>
            </div>

            <div class="action-details">
              <div>
                <div class="muted">Issued</div>
                <div>{formatIssued(action.issued_at)}</div>
              </div>
              <div>
                <div class="muted">Effective from</div>
                <div>{formatDay(action.effective_on ?? action.issued_at)}</div>
              </div>
              <div>
                <div class="muted">Duration</div>
                <div>{expiryLabel(action)}</div>
              </div>
            </div>

            <div class="reason">
              <div class="muted">Reason</div>
              <div>{action.reason || 'No reason recorded'}</div>
              {#if action.match_id && action.match_is_public === true}
                <div class="muted" style="margin-top:5px;">
                  Related match: <a href={`/match/${action.match_id}`}>{action.match_label ?? action.match_id.slice(0, 8)}</a>
                </div>
              {/if}
            </div>
          </article>
        {/each}
      </div>
    {:else}
      <div class="card alert alert-success" style="margin:12px 0 0;">
        No discipline action currently restricts your competitive play.
      </div>
    {/if}
  </section>

  <section class="card" aria-labelledby="discipline-history-title">
    <div class="section-heading">
      <div>
        <h2 id="discipline-history-title" class="card-title">Action history</h2>
        <div class="muted">This history is visible only to you and authorized club officials.</div>
      </div>
    </div>

    <div class="history-wrap">
      <table>
        <caption class="sr-only">Private discipline history for {player.label}</caption>
        <thead>
          <tr>
            <th>Action</th>
            <th>Issued</th>
            <th>Effective period</th>
            <th>Reason / match</th>
            <th>Source</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {#each actions as action}
            <tr class:history-row-revoked={!!action.revoked_at}>
              <td><span class={`status-badge ${statusTone(action.action_type)}`}>{actionTypeLabel(action)}</span></td>
              <td>{formatIssued(action.issued_at)}</td>
              <td>
                <div class="date-stack">
                  <span>From {formatDay(action.effective_on ?? action.issued_at)}</span>
                  <span class="muted">{expiryLabel(action)}</span>
                </div>
              </td>
              <td class="reason-cell">
                <div>{action.reason || 'No reason recorded'}</div>
                {#if action.match_id && action.match_is_public === true}
                  <div class="muted" style="margin-top:4px;">
                    Match: <a href={`/match/${action.match_id}`}>{action.match_label ?? action.match_id.slice(0, 8)}</a>
                  </div>
                {/if}
              </td>
              <td>{sourceLabel(action.source)}</td>
              <td>
                <div class="status-stack">
                  {#if action.revoked_at}
                    <span class="status-badge status-muted">Revoked</span>
                    <span class="muted">{formatIssued(action.revoked_at)}</span>
                    {#if action.revocation_reason}
                      <span>{action.revocation_reason}</span>
                    {/if}
                  {:else if isEffective(action)}
                    <span class={`status-badge ${statusTone(action.action_type)}`}>Effective</span>
                  {:else}
                    <span class="status-badge status-muted">Expired</span>
                  {/if}
                </div>
              </td>
            </tr>
          {/each}
          {#if actions.length === 0}
            <tr><td colspan="6" class="muted">No discipline actions have been recorded for you.</td></tr>
          {/if}
        </tbody>
      </table>
    </div>
  </section>
{/if}
