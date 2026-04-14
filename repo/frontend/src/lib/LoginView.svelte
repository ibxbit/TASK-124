<script>
  import { login } from './api.js';
  export let onAuthed = () => {};
  let username = 'admin';
  let password = 'admin';
  let error = '';
  async function submit() {
    error = '';
    try {
      const user = await login(username, password);
      onAuthed(user);
    } catch (e) {
      error = e.message || 'Login failed';
    }
  }
</script>

<div class="wrap">
  <form on:submit|preventDefault={submit}>
    <h2>Merchant Console</h2>
    <label>Username<input bind:value={username} autofocus /></label>
    <label>Password<input type="password" bind:value={password} /></label>
    {#if error}<p class="err">{error}</p>{/if}
    <button>Sign in</button>
  </form>
</div>

<style>
  .wrap { min-height: 100vh; display: grid; place-items: center; background: #0f172a; }
  form {
    background: white; padding: 32px; border-radius: 8px; width: 320px;
    display: flex; flex-direction: column; gap: 12px; color: #111827;
    font-family: Segoe UI, sans-serif;
  }
  h2 { margin: 0 0 8px; }
  label { display: flex; flex-direction: column; font-size: 13px; gap: 4px; }
  input { padding: 8px 10px; font-size: 14px; border: 1px solid #d1d5db; border-radius: 4px; }
  button { padding: 10px; background: #2563eb; color: white; border: 0; border-radius: 4px;
           font-weight: 600; cursor: pointer; }
  .err { color: #dc2626; font-size: 12px; margin: 0; }
</style>
