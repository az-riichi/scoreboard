<script lang="ts">
  let isSubmitting = false;
  let pendingLabel = 'Working...';

  function submitterLabel(submitter: HTMLElement | null | undefined) {
    if (!submitter) return '';
    if (submitter instanceof HTMLInputElement) return String(submitter.value ?? '').trim();
    return String(submitter.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  function progressLabel(rawLabel: string) {
    const label = rawLabel.trim();
    if (!label) return 'Working...';

    const lower = label.toLowerCase();
    if (lower.startsWith('save ')) return `Saving ${label.slice(5)}...`;
    if (lower.startsWith('create ')) return `Creating ${label.slice(7)}...`;
    if (lower.startsWith('delete ')) return `Deleting ${label.slice(7)}...`;
    if (lower.startsWith('remove ')) return `Removing ${label.slice(7)}...`;
    if (lower.startsWith('finalize ')) return `Finalizing ${label.slice(9)}...`;
    if (lower.startsWith('recompute ')) return `Recomputing ${label.slice(10)}...`;
    if (lower.startsWith('import ')) return `Importing ${label.slice(7)}...`;
    if (lower.startsWith('add ')) return `Adding ${label.slice(4)}...`;

    return `${label}...`;
  }

  function markSubmitterPending(submitter: HTMLElement | null | undefined, label: string) {
    if (submitter instanceof HTMLButtonElement) {
      submitter.disabled = true;
      submitter.textContent = label;
      submitter.setAttribute('aria-disabled', 'true');
      return;
    }

    if (submitter instanceof HTMLInputElement) {
      submitter.disabled = true;
      if (submitter.type === 'submit') submitter.value = label;
      submitter.setAttribute('aria-disabled', 'true');
    }
  }

  function onAdminSubmit(event: Event) {
    if (event.defaultPrevented) return;

    const submitEvent = event as SubmitEvent;
    const form = submitEvent.target;
    if (!(form instanceof HTMLFormElement)) return;

    if ((form.method || '').toLowerCase() !== 'post') return;

    const submitter = submitEvent.submitter instanceof HTMLElement ? submitEvent.submitter : null;
    const raw = submitterLabel(submitter);
    pendingLabel = progressLabel(raw);
    markSubmitterPending(submitter, pendingLabel);
    isSubmitting = true;
  }
</script>

<svelte:head>
  <style>
    .admin-submit-scope {
      position: relative;
    }

    .admin-submit-backdrop {
      position: fixed;
      inset: 0;
      z-index: 900;
      pointer-events: none;
      background: rgba(0, 0, 0, 0.04);
      backdrop-filter: blur(1px);
    }

    .admin-submit-toast {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 901;
      display: inline-flex;
      align-items: center;
      gap: 10px;
      max-width: min(460px, calc(100vw - 32px));
      padding: 10px 12px;
      border-radius: 14px;
      border: 1px solid var(--card-border);
      background: var(--card-bg);
      color: var(--text);
      box-shadow: 0 10px 24px rgba(0, 0, 0, 0.14);
      pointer-events: none;
    }

    .admin-submit-spinner {
      width: 14px;
      height: 14px;
      border-radius: 999px;
      border: 2px solid rgba(127, 127, 127, 0.25);
      border-top-color: currentColor;
      animation: admin-submit-spin 0.8s linear infinite;
      flex: 0 0 auto;
    }

    .admin-submit-text {
      font-weight: 600;
      line-height: 1.2;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    @keyframes admin-submit-spin {
      to { transform: rotate(360deg); }
    }

    @media (max-width: 640px) {
      .admin-submit-toast {
        right: 10px;
        left: 10px;
        bottom: 10px;
        max-width: none;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .admin-submit-spinner {
        animation: none;
      }
    }
  </style>
</svelte:head>

<div class="admin-submit-scope" on:submit={onAdminSubmit} aria-busy={isSubmitting}>
  <slot />

  {#if isSubmitting}
    <div class="admin-submit-backdrop" aria-hidden="true"></div>
    <div class="admin-submit-toast" role="status" aria-live="polite" aria-atomic="true">
      <span class="admin-submit-spinner" aria-hidden="true"></span>
      <span class="admin-submit-text">{pendingLabel}</span>
    </div>
  {/if}
</div>
