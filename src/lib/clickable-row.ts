import { goto } from '$app/navigation';

const INTERACTIVE_SELECTOR = 'a, button, input, select, textarea, label, summary, form';

function hasInteractiveTarget(event: MouseEvent) {
  return event.target instanceof Element && event.target.closest(INTERACTIVE_SELECTOR) !== null;
}

function hasSelectedText() {
  return window.getSelection()?.type === 'Range';
}

/**
 * Makes the non-interactive area of a table row follow its primary link.
 * Links, buttons, and form controls inside the row retain their own behavior.
 */
export function clickableRow(node: HTMLTableRowElement, initialHref: string) {
  let href = initialHref;
  node.dataset.clickableRow = '';

  function handleClick(event: MouseEvent) {
    if (!href || event.defaultPrevented || event.button !== 0 || event.altKey) return;
    if (hasInteractiveTarget(event) || hasSelectedText()) return;

    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      window.open(href, '_blank', 'noopener,noreferrer');
      return;
    }

    void goto(href);
  }

  function handleAuxClick(event: MouseEvent) {
    if (!href || event.defaultPrevented || event.button !== 1) return;
    if (hasInteractiveTarget(event) || hasSelectedText()) return;
    window.open(href, '_blank', 'noopener,noreferrer');
  }

  node.addEventListener('click', handleClick);
  node.addEventListener('auxclick', handleAuxClick);

  return {
    update(nextHref: string) {
      href = nextHref;
    },
    destroy() {
      delete node.dataset.clickableRow;
      node.removeEventListener('click', handleClick);
      node.removeEventListener('auxclick', handleAuxClick);
    }
  };
}
