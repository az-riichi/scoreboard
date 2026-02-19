<script lang="ts">
  export let form: any;
  let email = '';
  let password = '';
</script>

<div class="card" style="max-width:520px; margin: 0 auto;">
  <h2 style="margin:0 0 10px;">Admin sign in</h2>
  <p class="muted" style="margin-top:0;">Only admins can create players and enter results. Public pages do not require login.</p>

  {#if form?.message}
    <div class="card" style="border-color:#ffd08a; background:#fff8ed; margin-bottom:12px;">
      {form.message}
    </div>
  {/if}

  <form method="POST" action="?/signIn" style="display:grid; gap:10px; margin-bottom:18px;">
    <label>
      <div class="muted">Email</div>
      <input name="email" bind:value={email} type="email" autocomplete="email" required style="width:100%;" />
    </label>

    <label>
      <div class="muted">Password</div>
      <input name="password" bind:value={password} type="password" autocomplete="current-password" required style="width:100%;" />
    </label>

    <button class="btn primary" type="submit">Sign in</button>
  </form>

  <hr style="border:none; border-top:1px solid #eee; margin: 18px 0;" />

  <h3 style="margin:0 0 10px;">Create an account</h3>
  <form method="POST" action="?/signUp" style="display:grid; gap:10px;">
    <label>
      <div class="muted">Email</div>
      <input name="email" bind:value={email} type="email" autocomplete="email" required style="width:100%;" />
    </label>

    <label>
      <div class="muted">Password</div>
      <input name="password" bind:value={password} type="password" autocomplete="new-password" required style="width:100%;" />
    </label>

    <button class="btn" type="submit">Sign up</button>
  </form>
</div>
