<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';

  let experiments = [];
  let selected = null;
  let version = 1;
  let metrics = null;
  let status = '';

  async function load() {
    try { experiments = await api.get('/experiments'); }
    catch (e) { status = `offline: ${e.message}`; experiments = []; }
  }

  async function loadMetrics() {
    if (!selected) return;
    try { metrics = await api.get(`/experiments/${selected.id}/metrics?version=${version}`); }
    catch (e) { status = e.message; metrics = null; }
  }

  function selectExperiment(exp) {
    selected = exp;
    version = exp.latest_version || 1;
    loadMetrics();
  }

  onMount(load);
</script>

<h2>Experiment Lab — A/B Testing</h2>
<p class="status">{status}</p>

<div class="grid">
  <aside>
    <h3>Experiments</h3>
    <ul>
      {#each experiments as exp}
        <li class:active={selected?.id === exp.id} on:click={() => selectExperiment(exp)}>
          {exp.name} <span class="ver">v{exp.latest_version || '—'}</span>
        </li>
      {/each}
    </ul>
  </aside>

  <section>
    {#if selected}
      <div class="hdr">
        <h3>{selected.name}</h3>
        <label>Version
          <input type="number" bind:value={version} min="1" on:change={loadMetrics} />
        </label>
      </div>

      {#if metrics}
        {#if metrics.warnings?.length}
          <div class="warn">
            {#each metrics.warnings as w}<div>⚠ {w}</div>{/each}
          </div>
        {/if}

        <h4>Buckets</h4>
        <table>
          <thead><tr><th>Bucket</th><th>Impressions</th><th>Clicks</th>
            <th>Conversions</th><th>CTR</th><th>Conv Rate</th><th>7d Retention</th></tr></thead>
          <tbody>
            {#each Object.entries(metrics.buckets) as [name, b]}
              <tr>
                <td>{name}</td>
                <td>{b.impressions}</td>
                <td>{b.clicks}</td>
                <td>{b.conversions}</td>
                <td>{(b.ctr*100).toFixed(2)}%</td>
                <td>{(b.conversionRate*100).toFixed(2)}%</td>
                <td>{(b.retention7d*100).toFixed(2)}%</td>
              </tr>
            {/each}
          </tbody>
        </table>

        <h4>Significance (α = {metrics.alpha})</h4>
        <table>
          <thead><tr><th>Comparison</th><th>Metric</th><th>z-score</th>
            <th>p-value</th><th>Significant?</th></tr></thead>
          <tbody>
            {#each Object.entries(metrics.significance) as [pair, s]}
              {#each Object.entries(s) as [metric, r]}
                <tr>
                  <td>{pair}</td><td>{metric}</td>
                  <td>{r.zScore.toFixed(3)}</td>
                  <td>{r.pValue.toFixed(4)}</td>
                  <td class:sig={r.significant}>{r.significant ? 'YES' : 'no'}</td>
                </tr>
              {/each}
            {/each}
          </tbody>
        </table>

        <h4>Lift — cumulative CTR</h4>
        <div class="lift">
          {#each Object.entries(metrics.lift) as [bucket, pts]}
            <div class="series">
              <strong>{bucket}:</strong>
              {pts.map(p => (p.cumulativeCtr*100).toFixed(2) + '%').join(' · ')}
            </div>
          {/each}
        </div>
      {/if}
    {:else}
      <p>Select an experiment.</p>
    {/if}
  </section>
</div>

<style>
  h2 { margin: 0 0 8px; }
  .status { color: #2563eb; font-size: 12px; }
  .grid { display: grid; grid-template-columns: 280px 1fr; gap: 16px; }
  aside ul { list-style: none; padding: 0; margin: 0; }
  aside li { padding: 8px 12px; cursor: pointer; border-radius: 4px;
             display: flex; justify-content: space-between; }
  aside li.active { background: #dbeafe; }
  .ver { color: #6b7280; font-size: 12px; }
  .hdr { display: flex; align-items: baseline; gap: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 16px; }
  th, td { padding: 6px 10px; border-bottom: 1px solid #e5e7eb; text-align: left; }
  .warn { background: #fef3c7; color: #92400e; padding: 8px 12px;
          border-radius: 4px; margin-bottom: 12px; font-size: 12px; }
  .sig { color: #16a34a; font-weight: 600; }
  .lift .series { font-size: 11px; font-family: monospace;
                   padding: 4px 0; border-bottom: 1px solid #f3f4f6; }
</style>
