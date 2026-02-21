<script lang="ts">
  export let data: any;
</script>

<div class="card">
  <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap;">
    <div>
      <div style="font-size:1.1rem; font-weight:650;">Seasons</div>
      <div class="muted">Pick a season to view standings and stats</div>
    </div>
  </div>

  <div style="margin-top:12px; overflow:auto;">
    <table>
      <thead>
        <tr>
          <th>Season</th>
          <th style="width:160px;">Start</th>
          <th style="width:160px;">End</th>
          <th style="width:120px;">Active</th>
        </tr>
      </thead>
      <tbody>
        {#each data.seasons as s}
          <tr>
            <td><a href={`/season/${s.id}`} style="text-decoration:none;">{s.name}</a></td>
            <td>{s.start_date}</td>
            <td>{s.end_date}</td>
            <td>{s.is_active ? 'Yes' : ''}</td>
          </tr>
        {/each}
        {#if data.seasons.length === 0}
          <tr><td colspan="4" class="muted">No seasons yet.</td></tr>
        {/if}
      </tbody>
    </table>
  </div>
</div>
