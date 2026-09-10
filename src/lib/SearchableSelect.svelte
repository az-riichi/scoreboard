<script lang="ts">
  import { tick } from 'svelte';

  type SearchableOption = {
    id: string;
    label: string;
    disabled?: boolean;
  };

  export let name: string;
  export let inputId: string;
  export let options: SearchableOption[] = [];
  export let value = '';
  export let placeholder = 'Search options';
  export let ariaLabel = 'Search options';
  export let required = false;
  export let disabled = false;

  let inputElement: HTMLInputElement;
  let query = '';
  let isOpen = false;
  let hasFocus = false;
  let activeIndex = -1;
  let lastSyncedValue: string | null = null;

  $: selectedOption = options.find((option) => option.id === value) ?? null;
  $: if (!hasFocus && value !== lastSyncedValue) {
    query = selectedOption?.label ?? '';
    lastSyncedValue = value;
  }
  $: searchTerm = selectedOption?.label === query ? '' : normalize(query);
  $: filteredOptions = searchTerm
    ? options.filter((option) => normalize(option.label).includes(searchTerm))
    : options;
  $: activeOptionId =
    activeIndex >= 0 ? `${inputId}-option-${activeIndex}` : undefined;
  $: if (inputElement) {
    const hasInvalidText = query.trim().length > 0 && !selectedOption;
    inputElement.setCustomValidity(
      hasInvalidText ? 'Select a player from the search results.' : ''
    );
  }

  function normalize(text: string) {
    return text.trim().toLocaleLowerCase();
  }

  function findExactOption(text: string) {
    const normalized = normalize(text);
    if (!normalized) return null;
    return (
      options.find(
        (option) => !option.disabled && normalize(option.label) === normalized
      ) ?? null
    );
  }

  function handleInput(event: Event) {
    query = (event.currentTarget as HTMLInputElement).value;
    const exactOption = findExactOption(query);
    value = exactOption?.id ?? '';
    lastSyncedValue = value;
    activeIndex = -1;
    isOpen = true;
  }

  function handleFocus() {
    hasFocus = true;
    isOpen = !disabled;
  }

  function handleBlur() {
    hasFocus = false;
    isOpen = false;
    activeIndex = -1;
  }

  function choose(option: SearchableOption) {
    if (option.disabled) return;
    value = option.id;
    query = option.label;
    lastSyncedValue = value;
    isOpen = false;
    activeIndex = -1;
  }

  function moveActive(delta: 1 | -1) {
    const enabledIndexes = filteredOptions.flatMap((option, index) =>
      option.disabled ? [] : [index]
    );
    if (enabledIndexes.length === 0) return;

    const currentPosition = enabledIndexes.indexOf(activeIndex);
    if (currentPosition === -1) {
      activeIndex = delta === 1 ? enabledIndexes[0] : enabledIndexes.at(-1)!;
    } else {
      activeIndex =
        enabledIndexes[
          (currentPosition + delta + enabledIndexes.length) % enabledIndexes.length
        ];
    }

    void tick().then(() => {
      document.getElementById(`${inputId}-option-${activeIndex}`)?.scrollIntoView({
        block: 'nearest'
      });
    });
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      isOpen = true;
      moveActive(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      isOpen = true;
      moveActive(-1);
    } else if (event.key === 'Enter' && isOpen) {
      event.preventDefault();
      if (activeIndex >= 0) {
        choose(filteredOptions[activeIndex]);
      } else {
        const exactOption = findExactOption(query);
        if (exactOption) choose(exactOption);
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      isOpen = false;
      activeIndex = -1;
    }
  }
</script>

<style>
  .searchable-select {
    position: relative;
    width: 100%;
    min-width: 0;
  }

  .searchable-select input[type='search'] {
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
  }

  .searchable-select input[type='search']:focus {
    border-color: var(--btn-primary-bg);
    outline: none;
  }

  .option-list {
    position: absolute;
    inset: calc(100% + 4px) 0 auto;
    z-index: 40;
    max-height: 240px;
    overflow-y: auto;
    padding: 4px;
    border: 1px solid var(--field-border);
    border-radius: 12px;
    background: var(--field-bg);
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.16);
  }

  .option {
    display: block;
    width: 100%;
    padding: 8px 10px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .option.is-active,
  .option:hover {
    background: var(--pill-bg);
  }

  .option:disabled {
    color: var(--muted);
    cursor: not-allowed;
    opacity: 0.75;
  }

  .empty-option {
    padding: 8px 10px;
  }
</style>

<div class="searchable-select">
  <input
    bind:this={inputElement}
    id={inputId}
    type="search"
    value={query}
    {placeholder}
    {required}
    {disabled}
    autocomplete="off"
    spellcheck="false"
    role="combobox"
    aria-label={ariaLabel}
    aria-autocomplete="list"
    aria-expanded={isOpen}
    aria-controls={`${inputId}-listbox`}
    aria-activedescendant={activeOptionId}
    aria-invalid={query.trim().length > 0 && !selectedOption ? 'true' : undefined}
    on:input={handleInput}
    on:focus={handleFocus}
    on:blur={handleBlur}
    on:keydown={handleKeydown}
  />
  <input type="hidden" {name} {value} {disabled} />

  {#if isOpen}
    <div id={`${inputId}-listbox`} class="option-list" role="listbox">
      {#each filteredOptions as option, index (option.id)}
        <button
          id={`${inputId}-option-${index}`}
          class="option"
          class:is-active={index === activeIndex}
          type="button"
          role="option"
          tabindex="-1"
          aria-selected={option.id === value}
          disabled={option.disabled}
          on:mousedown|preventDefault
          on:mouseenter={() => {
            if (!option.disabled) activeIndex = index;
          }}
          on:click={() => choose(option)}
        >
          {option.label}
        </button>
      {/each}
      {#if filteredOptions.length === 0}
        <div class="empty-option muted" role="status">No matching players</div>
      {/if}
    </div>
  {/if}
</div>
