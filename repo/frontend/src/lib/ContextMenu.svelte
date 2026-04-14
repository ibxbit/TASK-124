<script>
  export let items = [];
  let visible = false;
  let x = 0, y = 0;
  let ctx = null;

  export function open(event, context) {
    event.preventDefault();
    x = event.clientX;
    y = event.clientY;
    ctx = context;
    visible = true;
  }

  function close() { visible = false; ctx = null; }
  function onItem(item) {
    if (item.disabled) return;
    item.action(ctx);
    close();
  }
  function onDocClick() { if (visible) close(); }
</script>

<svelte:window on:click={onDocClick} on:keydown={(e) => e.key === 'Escape' && close()} />

{#if visible}
  <ul class="ctx-menu" style="top:{y}px; left:{x}px">
    {#each items as item}
      <li class:disabled={item.disabled} on:click|stopPropagation={() => onItem(item)}>
        {item.label}
      </li>
    {/each}
  </ul>
{/if}

<style>
  .ctx-menu {
    position: fixed; min-width: 200px; margin: 0; padding: 4px 0;
    list-style: none; background: #1f2937; color: #f3f4f6;
    border: 1px solid #374151; border-radius: 4px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4); z-index: 9999; font-size: 13px;
  }
  .ctx-menu li { padding: 6px 14px; cursor: pointer; }
  .ctx-menu li:hover { background: #374151; }
  .ctx-menu li.disabled { color: #6b7280; cursor: not-allowed; }
</style>
