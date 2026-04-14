<script>
  import { onMount } from 'svelte';
  import { api, getToken } from '../lib/api.js';
  import { registerShortcut } from '../lib/shortcuts.js';
  import { copyAsCsv } from '../lib/clipboard.js';
  import { maskLast4, formatLast4, maskCardToken } from '../lib/mask.js';

  let cycles = [];
  let refunds = [];
  let tokens = [];
  let showSensitive = false;
  let refundPaymentId = '';
  let refundAmount = '';
  let refundReason = '';
  let periodFrom = '';
  let periodTo = '';
  let status = '';

  async function loadCycles()  { try { cycles  = await api.get('/settlement/cycles'); } catch (e) { status = e.message; } }
  async function loadRefunds() { try { refunds = await api.get('/refunds'); }           catch (e) { status = e.message; } }
  async function loadTokens()  { try { tokens  = await api.get('/vault/financial-tokens?ownerType=merchant&ownerId=M1'); } catch (e) { /* ignore if no permission */ } }

  async function runCycle() {
    try { const r = await api.post('/settlement/run', {}); status = `cycle ${r.cycleId} started`; await loadCycles(); }
    catch (e) { status = e.message; }
  }

  async function createRefund() {
    if (!refundPaymentId || !refundAmount) return;
    try {
      const r = await api.post('/refunds/issue',
        { paymentId: Number(refundPaymentId), amount: Number(refundAmount), reason: refundReason });
      status = `refund #${r.id} ${r.status}`;
      refundPaymentId = ''; refundAmount = ''; refundReason = '';
      await loadRefunds();
    } catch (e) { status = e.message; }
  }

  async function executeRefund(id) {
    try { await api.post(`/refunds/${id}/execute`, {}); status = `refund ${id} executed`; await loadRefunds(); }
    catch (e) { status = e.message; }
  }

  async function exportReconciliation() {
    if (!periodFrom || !periodTo) { status = 'enter MM/DD/YYYY dates'; return; }
    const url = `${import.meta.env.VITE_API_URL || 'http://127.0.0.1:3131'}`
      + `/reconciliation/export?type=summary&format=csv`
      + `&from=${encodeURIComponent(periodFrom)}&to=${encodeURIComponent(periodTo)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!res.ok) { status = `export failed: ${res.status}`; return; }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `reconciliation_${periodFrom}_${periodTo}.csv`.replace(/\//g,'-');
    a.click();
    status = 'reconciliation downloaded';
  }

  async function exportCyclesToClipboard() {
    const csv = await copyAsCsv(cycles,
      ['id','period_start','period_end','status','total_gross','total_fees','total_net']);
    status = `cycles copied (${csv.length} chars)`;
  }

  onMount(() => {
    registerShortcut('exportData', 'Ctrl+Shift+E', exportCyclesToClipboard);
    loadCycles();
    loadRefunds();
    loadTokens();
  });
</script>

<h2>Settlement Workbench</h2>
<p class="status">{status}</p>
<label class="toggle">
  <input type="checkbox" bind:checked={showSensitive} /> Show full amounts
</label>

<section class="panel">
  <h3>Run Weekly Settlement</h3>
  <button on:click={runCycle}>Run cycle (Sunday 23:59 cutoff)</button>
</section>

<section class="panel">
  <h3>Issue Refund</h3>
  <div class="row">
    <input placeholder="Payment ID"   bind:value={refundPaymentId} />
    <input placeholder="Amount"       bind:value={refundAmount}    />
    <input placeholder="Reason"       bind:value={refundReason}    />
    <button on:click={createRefund}>Issue</button>
  </div>
</section>

<section class="panel">
  <h3>Reconciliation Export</h3>
  <div class="row">
    <input placeholder="From MM/DD/YYYY" bind:value={periodFrom} />
    <input placeholder="To MM/DD/YYYY"   bind:value={periodTo}   />
    <button on:click={exportReconciliation}>Download CSV</button>
    <button on:click={exportCyclesToClipboard}>Copy cycles CSV (Ctrl+Shift+E)</button>
  </div>
</section>

<section>
  <h3>Recent Cycles</h3>
  <table>
    <thead><tr><th>ID</th><th>Start</th><th>End</th><th>Status</th>
      <th>Gross</th><th>Fees</th><th>Net</th></tr></thead>
    <tbody>
      {#each cycles as c}
        <tr>
          <td>{c.id}</td>
          <td>{new Date(c.period_start).toLocaleDateString()}</td>
          <td>{new Date(c.period_end).toLocaleDateString()}</td>
          <td>{c.status}</td>
          <td>{showSensitive ? c.total_gross : maskLast4(String(c.total_gross))}</td>
          <td>{showSensitive ? c.total_fees  : maskLast4(String(c.total_fees))}</td>
          <td>{showSensitive ? c.total_net   : maskLast4(String(c.total_net))}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</section>

<section>
  <h3>Refunds</h3>
  <table>
    <thead><tr><th>ID</th><th>Payment</th><th>Provider</th><th>Amount</th>
      <th>Status</th><th></th></tr></thead>
    <tbody>
      {#each refunds as r}
        <tr>
          <td>{r.id}</td><td>{r.payment_id}</td><td>{r.provider}</td>
          <td>{showSensitive ? r.amount : maskLast4(String(r.amount))}</td>
          <td>{r.status}</td>
          <td>{#if r.status === 'approved'}
            <button on:click={() => executeRefund(r.id)}>Execute</button>
          {/if}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</section>

{#if tokens.length}
<section>
  <h3>Financial Tokens</h3>
  <table>
    <thead><tr><th>ID</th><th>Type</th><th>Token</th><th>Created</th></tr></thead>
    <tbody>
      {#each tokens as t}
        <tr>
          <td>{t.id}</td>
          <td>{t.token_type}</td>
          <td>{showSensitive ? formatLast4(t.last4) : maskCardToken(t.last4)}</td>
          <td>{new Date(t.created_at).toLocaleDateString()}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</section>
{/if}

<style>
  h2 { margin: 0 0 8px; }
  h3 { margin: 14px 0 6px; font-size: 13px; color: #374151; }
  .status { color: #2563eb; font-size: 12px; }
  .panel { background: #f9fafb; padding: 10px 12px; border-radius: 4px; margin-bottom: 10px; }
  .row { display: flex; gap: 8px; }
  input { padding: 6px 10px; border: 1px solid #d1d5db; border-radius: 4px; flex: 1; }
  button { padding: 6px 12px; cursor: pointer; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { padding: 6px 10px; border-bottom: 1px solid #e5e7eb; text-align: left; }
</style>
