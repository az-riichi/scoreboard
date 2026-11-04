<script lang="ts">
  import { clickableRow } from '$lib/clickable-row';
  import { seasonKanji } from '$lib/mahjong';

  export let data: any;
</script>

<div class="card">
  <div class="title-row">
    <span class="led-tag" lang="ja" aria-hidden="true">シーズン</span>
    <h1 class="page-title">Seasons</h1>
  </div>
  <div class="muted" style="margin-top:4px;">Pick a season to view standings and stats</div>

  <div style="margin-top:12px; overflow:auto;">
    <table>
      <thead>
        <tr>
          <th>Season</th>
          <th style="width:120px;">Type</th>
          <th style="width:250px;">Period</th>
          <th style="width:120px;">Active</th>
        </tr>
      </thead>
      <tbody>
        {#each data.seasons as s}
          <tr use:clickableRow={`/season/${s.id}`}>
            <td>
              <a href={`/season/${s.id}`} class="wind-cell" style="text-decoration:none; font-weight:600;">
                <span class="wind" class:is-lit={s.is_active} lang="ja" aria-hidden="true">{seasonKanji(s.name, s.is_casual)}</span>
                {s.name}
              </a>
            </td>
            <td><span class="tag">{s.is_casual ? 'Casual' : 'Regular'}</span></td>
            <td>{s.is_casual ? 'No time limit' : `${s.start_date} → ${s.end_date}`}</td>
            <td>
              {#if s.is_active}
                <span class="status-live"><span class="led-dot is-on is-blink" aria-hidden="true"></span>Active</span>
              {/if}
            </td>
          </tr>
        {/each}
        {#if data.seasons.length === 0}
          <tr><td colspan="4" class="muted">No seasons yet.</td></tr>
        {/if}
      </tbody>
    </table>
  </div>
</div>
