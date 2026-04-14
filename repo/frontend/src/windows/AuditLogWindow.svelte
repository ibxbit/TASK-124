<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';

  let logs = [];
  let status = '';
  let filter = '';

  async function load() {
    try {
      logs = await api.get('/audit/logs');
    } catch (e) {
      status = `Error: ${e.message}`;
    }
  }

  onMount(load);
</script>

<h2>System Audit Log</h2>
<p class="status">{status}</p>

<div class="controls">
  <input placeholder="Filter by action or user..." bind:value={filter} />
  <button on:click={load}>Refresh</button>
</div>

<div class="table-container">
  <table>
    <thead>
      <tr>
        <th>Time</th>
        <th>User</th>
        <th>Role</th>
        <th>Action</th>
        <th>Resource</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      {#each logs.filter(l => !filter || JSON.stringify(l).toLowerCase().includes(filter.toLowerCase())) as l}
        <tr class={l.status === 'denied' ? 'denied' : ''}>
          <td>{new Date(l.created_at).toLocaleString()}</td>
          <td>{l.user_id || 'System'}</td>
          <td>{l.role || '-'}</td>
          <td>{l.action}</td>
          <td>{l.resource}</td>
          <td>{l.status}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  h2 { margin: 0 0 10px; }
  .status { font-size: 12px; color: #6b7280; }
  .controls { display: flex; gap: 10px; margin-bottom: 10px; }
  .controls input { flex: 1; padding: 6px 10px; border: 1px solid #d1d5db; border-radius: 4px; }
  .table-container { overflow-y: auto; flex: 1; border: 1px solid #e5e7eb; border-radius: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #f3f4f6; }
  th { background: #f9fafb; position: sticky; top: 0; }
  tr:hover { background: #f8fafc; }
  tr.denied { color: #dc2626; background: #fef2f2; }
</style>
