<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { registerShortcut } from '../lib/shortcuts.js';
  import ContextMenu from '../lib/ContextMenu.svelte';
  import { buildRowContextMenu } from '../lib/contextActions.js';

  let reports = [];
  let appeals = [];
  let selected = null;
  let status = '';
  let search = '';
  let searchOpen = false;
  let menu;

  async function load() {
    try {
      reports = await api.get('/reports');
      appeals = await api.get('/appeals');
    } catch (e) { status = `offline: ${e.message}`; }
  }

  async function resolve(outcome) {
    if (!selected) return;
    try {
      await api.post(`/reports/${selected.id}/resolve`, { outcome });
      status = `${selected.id} → ${outcome}`;
      selected = null;
      await load();
    } catch (e) { status = e.message; }
  }

  function onApprove() { resolve('no_action'); }

  function onRowContext(e, row) {
    menu.open(e, row);
    menu.$set({
      items: buildRowContextMenu({
        cellValue: row.id,
        row,
        onOpenOrder: () => window.desktop?.windows.open('settlement'),
        onFlagAnomaly: (r) => { status = `flagged #${r.id}`; }
      })
    });
  }

  onMount(() => {
    registerShortcut('approveAction', 'Ctrl+Return', onApprove);
    registerShortcut('globalSearch',  'Ctrl+K',      () => { searchOpen = true; });
    load();
  });
</script>

<h2>Moderation Queue</h2>
<p class="status">{status}</p>

{#if searchOpen}
  <div class="overlay" on:click={() => searchOpen = false}>
    <input autofocus placeholder="Search reports / appeals…" bind:value={search}
           on:click|stopPropagation />
  </div>
{/if}

<section>
  <h3>Open reports ({reports.length})</h3>
  <table>
    <thead><tr><th>ID</th><th>Type</th><th>Target</th><th>Reason</th><th>Created</th></tr></thead>
    <tbody>
      {#each reports.filter(r => !search || JSON.stringify(r).toLowerCase().includes(search.toLowerCase())) as r}
        <tr class:selected={selected?.id === r.id}
            on:click={() => selected = r}
            on:contextmenu={(e) => onRowContext(e, r)}>
          <td>{r.id}</td>
          <td>{r.target_type}</td>
          <td>{r.target_id}</td>
          <td>{r.reason}</td>
          <td>{new Date(r.created_at).toLocaleString()}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</section>

<section>
  <h3>Pending appeals ({appeals.length})</h3>
  <table>
    <thead><tr><th>ID</th><th>Review</th><th>Reason</th><th>Created</th></tr></thead>
    <tbody>
      {#each appeals as a}
        <tr><td>{a.id}</td><td>{a.review_id}</td><td>{a.reason}</td>
            <td>{new Date(a.created_at).toLocaleString()}</td></tr>
      {/each}
    </tbody>
  </table>
</section>

{#if selected}
  <div class="bar">
    <span>#{selected.id}</span>
    <button on:click={() => resolve('remove')}>Remove</button>
    <button on:click={() => resolve('warn')}>Warn</button>
    <button on:click={() => resolve('no_action')}>No action (Ctrl+Enter)</button>
  </div>
{/if}

<ContextMenu bind:this={menu} />

<style>
  h2 { margin: 0 0 8px; } h3 { margin: 16px 0 6px; font-size: 13px; color: #374151; }
  .status { color: #2563eb; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { padding: 6px 10px; border-bottom: 1px solid #e5e7eb; text-align: left; }
  tr.selected { background: #dbeafe; }
  .bar { position: sticky; bottom: 0; display: flex; gap: 8px; padding: 10px;
         background: #f8fafc; border-top: 1px solid #e5e7eb; align-items: center; }
  .bar button { padding: 6px 12px; cursor: pointer; }
  .overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4);
             display: flex; align-items: flex-start; justify-content: center; padding-top: 120px; }
  .overlay input { width: 520px; padding: 12px 16px; font-size: 16px;
                   border: 1px solid #d1d5db; border-radius: 6px; }
</style>
