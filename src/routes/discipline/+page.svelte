<script lang="ts">
  import { fmtDateArizona, fmtDateTimeArizona } from '$lib/arizona-time';
  import { isDisciplineActionEffective } from '$lib/discipline';

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

  const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

  function asText(value: unknown) {
    return String(value ?? '').trim();
  }

  function actionTypeLabel(value: unknown) {
    const type = asText(typeof value === 'object' && value ? (value as any).action_type : value).toLowerCase();
    if (type === 'strike') return 'Strike';
    if (type === 'suspension') return 'Suspension';
    if (type === 'ban') return 'Ban';
    return type ? type.charAt(0).toUpperCase() + type.slice(1).replaceAll('_', ' ') : 'Action';
  }

  function statusLabel(value: unknown) {
    const status = asText(value).toLowerCase();
    if (status === 'ban' || status === 'banned') return 'Banned';
    if (status === 'suspension' || status === 'suspended') return 'Suspended';
    if (status === 'strike' || status === 'strikes') return 'Active strikes';
    return 'Good standing';
  }

  function statusTone(value: unknown) {
    const status = asText(value).toLowerCase();
    if (status === 'ban' || status === 'banned') return 'status-ban';
    if (status === 'suspension' || status === 'suspended') return 'status-suspension';
    if (status === 'strike' || status === 'strikes') return 'status-strike';
    return 'status-clear';
  }

  function formatIssued(value: unknown) {
    const text = asText(value);
    return text ? fmtDateTimeArizona(text) : '—';
  }

  function formatDay(value: unknown) {
    const text = asText(value);
    if (!text) return '—';
    return fmtDateArizona(dateOnlyPattern.test(text) ? `${text}T12:00:00Z` : text);
  }

  function isEffective(action: any) {
    try {
      return isDisciplineActionEffective(action);
    } catch {
      return false;
    }
  }

  function expiryLabel(action: any) {
    if (action?.expires_on) return `Through ${formatDay(action.expires_on)} (inclusive)`;
    if (asText(action?.action_type).toLowerCase() === 'ban') return 'Permanent';
    return 'No expiration';
  }

  function sourceLabel(value: unknown) {
    const text = asText(value);
    if (!text) return 'Manual';
    return text
      .replaceAll('_', ' ')
      .replace(/\b\w/g, (character) => character.toUpperCase());
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

  .page-title {
    font-size: 1.25rem;
    font-weight: 700;
  }

  .section-title {
    font-size: 1.05rem;
    font-weight: 650;
  }

  .private-label {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--pill-border);
    border-radius: 999px;
    padding: 5px 9px;
    background: var(--pill-bg);
    color: var(--muted);
    font-size: 0.84rem;
    font-weight: 650;
  }

  .status-badge {
    display: inline-flex;
    align-items: center;
    border: 1px solid;
    border-radius: 999px;
    padding: 4px 9px;
    font-size: 0.84rem;
    font-weight: 700;
    line-height: 1.2;
  }

  .status-clear {
    color: var(--alert-success-text);
    border-color: var(--alert-success-border);
    background: var(--alert-success-bg);
  }

  .status-strike,
  .status-suspension {
    color: var(--alert-warning-text);
    border-color: var(--alert-warning-border);
    background: var(--alert-warning-bg);
  }

  .status-ban {
    color: var(--alert-error-text);
    border-color: var(--alert-error-border);
    background: var(--alert-error-bg);
  }

  .status-muted {
    color: var(--muted);
    border-color: var(--pill-border);
    background: var(--pill-bg);
  }

  .summary-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    margin-top: 12px;
  }

  .summary-item {
    border: 1px solid var(--table-border);
    border-radius: 14px;
    padding: 12px;
    min-width: 0;
  }

  .summary-value {
    margin-top: 4px;
    font-size: 1.2rem;
    font-weight: 700;
  }

  .effective-list {
    display: grid;
    gap: 10px;
    margin-top: 12px;
  }

  .effective-action {
    border-left: 4px solid var(--alert-warning-border);
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
      <div class="page-title">My discipline status</div>
      <div class="muted">Your current competitive-play status and discipline record</div>
    </div>
    <span class="private-label">Private to you and authorized club officials</span>
  </div>
</div>

{#if !player}
  <div class="card empty-state">
    <div class="section-title">No player profile is linked to this account</div>
    <p class="muted" style="margin:8px 0 0;">
      Ask a club official to link your login to your player profile. Your discipline status will appear here once it is linked.
    </p>
  </div>
{:else}
  <div class="card" style="margin-bottom:12px;">
    <div class="section-heading">
      <div>
        <div class="section-title">{player.label}</div>
        <div class="muted">Current status</div>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
        <span class={`status-badge ${statusTone(summary?.status)}`}>{statusLabel(summary?.status)}</span>
        <a class="btn" href={`/player/${player.id}`} style="text-decoration:none;">View profile</a>
      </div>
    </div>

    <div class="summary-grid">
      <div class="summary-item">
        <div class="muted">Competitive play</div>
        <div class="summary-value" style="font-size:1rem;">
          {statusLabel(summary?.status) === 'Good standing' ? 'Allowed' : 'Restricted'}
        </div>
      </div>
      <div class="summary-item">
        <div class="muted">Active strikes</div>
        <div class="summary-value">{summary?.activeStrikeCount ?? 0}</div>
      </div>
      <div class="summary-item">
        <div class="muted">Suspensions issued</div>
        <div class="summary-value">{summary?.suspensionCount ?? 0}</div>
      </div>
    </div>
  </div>

  <section class="card" style="margin-bottom:12px;" aria-labelledby="current-actions-title">
    <div class="section-heading">
      <div>
        <div id="current-actions-title" class="section-title">Currently effective actions</div>
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
        <div id="discipline-history-title" class="section-title">Private action history</div>
        <div class="muted">This history is visible only to you and authorized club officials.</div>
      </div>
      <span class="private-label">Private</span>
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
