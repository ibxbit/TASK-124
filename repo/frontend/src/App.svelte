<script>
  import { onMount } from 'svelte';
  import { route } from './lib/router.js';
  import { initShortcuts } from './lib/shortcuts.js';
  import { getToken, logout } from './lib/api.js';
  import LoginView from './lib/LoginView.svelte';
  import QueueWindow from './windows/QueueWindow.svelte';
  import ExperimentLabWindow from './windows/ExperimentLabWindow.svelte';
  import SettlementWorkbenchWindow from './windows/SettlementWorkbenchWindow.svelte';

  let authed = !!getToken();

  function onAuthed() { authed = true; }
  function onLogout() { logout(); authed = false; }

  onMount(initShortcuts);
</script>

{#if !authed}
  <LoginView {onAuthed} />
{:else}
  <main>
    <nav>
      <strong>Merchant Console</strong>
      <a href="#/queue"      class:active={$route === '/queue'}>Queue</a>
      <a href="#/lab"        class:active={$route === '/lab'}>Experiment Lab</a>
      <a href="#/settlement" class:active={$route === '/settlement'}>Settlement</a>
      <button on:click={onLogout}>Sign out</button>
    </nav>

    {#if $route === '/lab'}
      <ExperimentLabWindow />
    {:else if $route === '/settlement'}
      <SettlementWorkbenchWindow />
    {:else}
      <QueueWindow />
    {/if}
  </main>
{/if}

<style>
  :global(body) { margin: 0; background: #f3f4f6; }
  main { font-family: Segoe UI, sans-serif; padding: 16px; color: #111827; }
  nav { display: flex; gap: 16px; align-items: center; padding: 8px 0;
        border-bottom: 1px solid #e5e7eb; margin-bottom: 12px; }
  nav strong { margin-right: 16px; }
  nav a { color: #374151; text-decoration: none; font-size: 14px;
          padding: 4px 8px; border-radius: 4px; }
  nav a.active { background: #2563eb; color: white; }
  nav button { margin-left: auto; padding: 4px 10px; cursor: pointer; }
</style>
