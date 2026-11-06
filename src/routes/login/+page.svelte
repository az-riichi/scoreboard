<script lang="ts">
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';

  export let data: any;
  export let form: any;
  let signInEmail = '';
  let signInPassword = '';
  let signUpEmail = '';
  let signUpPassword = '';
  let resetEmail = '';
  let isResetPending = false;

  const submitPasswordReset: SubmitFunction = ({ cancel }) => {
    if (isResetPending) {
      cancel();
      return;
    }

    isResetPending = true;
    return async ({ update }) => {
      try {
        await update({ reset: false, invalidateAll: false });
      } finally {
        isResetPending = false;
      }
    };
  };
</script>

<style>
  .auth-card {
    width: min(520px, 100%);
    margin: 0 auto;
    box-sizing: border-box;
    min-width: 0;
  }

  .auth-card label {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  .auth-card input {
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
  }

  .auth-card .alert {
    overflow-wrap: anywhere;
  }

  .auth-card button:disabled {
    cursor: wait;
    opacity: 0.65;
  }
</style>

<div class="card auth-card">
  <div class="title-row" style="margin-bottom:14px;">
    <span class="led-tag" lang="ja" aria-hidden="true">ログイン</span>
    <h1 class="page-title">Sign in</h1>
  </div>

  {#if data?.notice}
    <div class="card alert alert-success" role="status">
      {data.notice}
    </div>
  {/if}

  {#if form?.message}
    <div
      class="card alert"
      class:alert-success={form.ok === true}
      class:alert-error={form.ok === false}
      class:alert-warning={form.ok == null}
      role="status"
    >
      {form.message}
    </div>
  {/if}

  <form method="POST" action="?/signIn" style="display:grid; gap:10px; margin-bottom:18px;">
    <input type="hidden" name="next" value={data?.next ?? ''} />
    <label>
      <div class="muted">Email</div>
      <input name="signin-email" bind:value={signInEmail} type="email" autocomplete="email" required />
    </label>

    <label>
      <div class="muted">Password</div>
      <input name="signin-password" bind:value={signInPassword} type="password" autocomplete="current-password" required />
    </label>

    <button class="btn primary" type="submit">Sign in</button>
  </form>

  <hr class="divider" />

  <h2 class="card-title" style="margin-bottom:10px;">Create an account</h2>
  <form method="POST" action="?/signUp" style="display:grid; gap:10px;">
    <input type="hidden" name="next" value={data?.next ?? ''} />
    <label>
      <div class="muted">Email</div>
      <input name="signup-email" bind:value={signUpEmail} type="email" autocomplete="email" required />
    </label>

    <label>
      <div class="muted">Password</div>
      <input name="signup-password" bind:value={signUpPassword} type="password" autocomplete="new-password" required />
    </label>

    <button class="btn" type="submit">Sign up</button>
  </form>

  <hr class="divider" />

  <h2 class="card-title" style="margin-bottom:10px;">Reset password</h2>
  <form
    method="POST"
    action="?/requestPasswordReset"
    use:enhance={submitPasswordReset}
    aria-busy={isResetPending}
    style="display:grid; gap:10px;"
  >
    <label>
      <div class="muted">Email</div>
      <input name="reset-email" bind:value={resetEmail} type="email" autocomplete="email" readonly={isResetPending} required />
    </label>

    <button class="btn" type="submit" disabled={isResetPending}>
      {isResetPending ? 'Sending...' : 'Send reset link'}
    </button>
  </form>
</div>
