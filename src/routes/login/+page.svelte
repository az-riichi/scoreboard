<script lang="ts">
  export let data: any;
  export let form: any;
  let signInEmail = '';
  let signInPassword = '';
  let signUpEmail = '';
  let signUpPassword = '';
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
  <h2 style="margin:0 0 10px;">Sign in</h2>
  <p class="muted" style="margin-top:0;">Admins can create players, link accounts, and enter results.</p>

  {#if form?.message}
    <div class="card alert alert-warning">
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

  <hr style="border:none; border-top:1px solid #eee; margin: 18px 0;" />

  <h3 style="margin:0 0 10px;">Create an account</h3>
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
</div>
