<script lang="ts">
  import { clickableRow } from '$lib/clickable-row';
  import { seasonKanji } from '$lib/mahjong';

  export let data: any;
</script>

<style>
  @media (max-width: 560px) {
    .col-period {
      display: none;
    }
  }
</style>

<div class="card">
  <div class="title-row">
    <span class="led-tag" lang="ja" aria-hidden="true">シーズン</span>
    <h1 class="page-title">Seasons</h1>
  </div>

  <div style="margin-top:12px; overflow:auto;">
    <table>
      <thead>
        <tr>
          <th>Season</th>
          <th class="col-period" style="width:250px;">Period</th>
          <th style="width:110px;"><span class="sr-only">Status</span></th>
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
            <td class="col-period">{s.is_casual ? '' : `${s.start_date} → ${s.end_date}`}</td>
            <td>
              {#if s.is_active}
                <span class="status-live"><span class="led-dot is-on is-blink" aria-hidden="true"></span>Active</span>
              {/if}
            </td>
          </tr>
        {/each}
        {#if data.seasons.length === 0}
          <tr><td colspan="3" class="muted">No seasons yet.</td></tr>
        {/if}
      </tbody>
    </table>
  </div>
</div>
