<script lang="ts">
  import { fmtDateTime } from '$lib/ui';
  export let data: any;
</script>

<div class="card" style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:end; margin-bottom:12px;">
  <div>
    <div style="font-size:1.1rem; font-weight:650;">Admin</div>
    <div class="muted">Manage seasons, players, matches, and finalize results.</div>
  </div>
  <div style="display:flex; gap:10px; flex-wrap:wrap;">
    <a class="btn" href="/admin/seasons" style="text-decoration:none;">Seasons</a>
    <a class="btn" href="/admin/players" style="text-decoration:none;">Players</a>
    <a class="btn primary" href="/admin/matches" style="text-decoration:none;">Matches</a>
  </div>
</div>

<div class="card">
  <div style="font-size:1.05rem; font-weight:650;">Draft matches</div>
  <div class="muted">Matches not yet finalized (not public).</div>

  <div style="margin-top:12px; overflow:auto;">
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Match</th>
          <th style="width:160px;"></th>
        </tr>
      </thead>
      <tbody>
        {#each data.drafts as m}
          <tr>
            <td>{fmtDateTime(m.played_at)}</td>
            <td>{m.table_label ?? m.id.slice(0,8)}</td>
            <td><a class="btn" href={`/admin/match/${m.id}`} style="text-decoration:none;">Open</a></td>
          </tr>
        {/each}
        {#if data.drafts.length === 0}
          <tr><td colspan="3" class="muted">No drafts.</td></tr>
        {/if}
      </tbody>
    </table>
  </div>
</div>
