<script lang="ts">
  import MatchSummaryTable from '$lib/MatchSummaryTable.svelte';

  export let data: import('./$types').PageData;

  $: count = data.matches.length;
  $: seasonHref = `/season/${data.season.id}${data.eventId ? `?event=${encodeURIComponent(data.eventId)}` : ''}`;

  function submitEventFilter(event: Event) {
    (event.currentTarget as HTMLSelectElement).form?.requestSubmit();
  }
</script>

<style>
  .matches-controls {
    display: flex;
    gap: 10px 14px;
    align-items: center;
    flex-wrap: wrap;
  }
  .event-filter {
    display: flex;
    align-items: center;
    gap: 8px;
  }
</style>

<div class="card">
  <div class="card-head">
    <div>
      <div class="title-row">
        <span class="led-tag" lang="ja" aria-hidden="true">対局一覧</span>
        <h1 class="page-title">{data.season.name} matches</h1>
      </div>
      <div class="muted">{count} {count === 1 ? 'match' : 'matches'}</div>
    </div>
    <div class="matches-controls">
      {#if data.isCasual}
        <form method="GET">
          <label class="event-filter">
            <span class="muted">Event</span>
            <select name="event" value={data.eventId ?? ''} on:change={submitEventFilter}>
              <option value="">All events</option>
              {#each data.events as event (event.id)}
                <option value={event.id}>{event.name}</option>
              {/each}
            </select>
          </label>
        </form>
      {/if}
      <a class="btn" href={seasonHref}>Back to season</a>
    </div>
  </div>

  <div style="margin-top:12px; overflow:auto;">
    <MatchSummaryTable matches={data.matches} seasonId={data.season.id} eventId={data.eventId} />
  </div>
</div>
