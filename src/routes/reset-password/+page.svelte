<script lang="ts">
  export let data: any;
  export let form: any;

  let password = '';
  let passwordConfirmation = '';
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
</style>

<div class="card auth-card">
  <h2 style="margin:0 0 10px;">Choose a new password</h2>

  {#if form?.message}
    <div
      class="card alert"
      class:alert-success={form.ok === true}
      class:alert-error={form.ok === false}
      role="status"
    >
      {form.message}
    </div>
  {/if}

  {#if data.canReset && form?.ok !== true}
    <p class="muted" style="margin-top:0;">Enter the new password you want to use for your account.</p>
    <form method="POST" action="?/updatePassword" style="display:grid; gap:10px;">
      <label>
        <div class="muted">New password</div>
        <input
          name="password"
          bind:value={password}
          type="password"
          autocomplete="new-password"
          required
        />
      </label>

      <label>
        <div class="muted">Confirm new password</div>
        <input
          name="password-confirmation"
          bind:value={passwordConfirmation}
          type="password"
          autocomplete="new-password"
          required
        />
      </label>

      <button class="btn primary" type="submit">Update password</button>
    </form>
  {:else if !form?.message}
    <div class="card alert alert-error" role="alert">
      {data.message}
    </div>
  {/if}

  {#if !data.canReset}
    <a class="btn" href="/login" style="text-decoration:none;">Back to sign in</a>
  {:else if form?.ok === true}
    <a class="btn primary" href="/" style="text-decoration:none;">Continue</a>
  {/if}
</div>
