<script lang="ts">
  import { fmtDate, fmtDateTime, fmtMonthDay } from '$lib/ui';

  export let value: string;
  /** Show the time where there is room for it. */
  export let withTime = false;
  /** Keep the year on phones, for dates shown without a list around them. */
  export let keepYear = false;
</script>

<style>
  .mid,
  .short {
    display: none;
  }
  @media (max-width: 1024px) {
    .wide {
      display: none;
    }
    .mid {
      display: inline;
    }
  }
  @media (max-width: 560px) {
    .mid.can-shorten {
      display: none;
    }
    .short {
      display: inline;
    }
  }
</style>

<time datetime={value}>
  <span class="wide">{withTime ? fmtDateTime(value) : fmtDate(value)}</span>
  <span class="mid" class:can-shorten={!keepYear}>{fmtDate(value)}</span>
  {#if !keepYear}
    <span class="short">{fmtMonthDay(value)}</span>
  {/if}
</time>
