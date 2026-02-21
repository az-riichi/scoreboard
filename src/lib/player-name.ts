export type PlayerNameFields = {
  display_name?: string | null;
  real_first_name?: string | null;
  real_last_name?: string | null;
  show_display_name?: boolean | null;
  show_real_first_name?: boolean | null;
  show_real_last_name?: boolean | null;
};

function clean(value: string | null | undefined): string {
  return (value ?? '').trim();
}

export type SeasonNameParts = {
  primary: string;
  secondary: string | null;
};

export function composePlayerDisplayName(player: PlayerNameFields): string {
  const display = clean(player.display_name);
  const first = clean(player.real_first_name);
  const last = clean(player.real_last_name);

  const showDisplay = player.show_display_name ?? true;
  const showFirst = player.show_real_first_name ?? false;
  const showLast = player.show_real_last_name ?? false;

  const parts: string[] = [];
  if (showDisplay && display) parts.push(display);
  if (showFirst && first) parts.push(first);
  if (showLast && last) parts.push(last);

  if (parts.length) return parts.join(' ');

  if (display) return display;
  if (first && last) return `${first} ${last}`;
  if (first) return first;
  if (last) return last;
  return 'Unnamed player';
}

export function composeSeasonNameParts(player: PlayerNameFields): SeasonNameParts {
  const nickname = clean(player.display_name);
  const first = clean(player.real_first_name);
  const last = clean(player.real_last_name);
  const realName = [first, last].filter(Boolean).join(' ').trim();

  if (realName && nickname) {
    return { primary: realName, secondary: nickname };
  }
  if (realName) {
    return { primary: realName, secondary: null };
  }
  if (nickname) {
    return { primary: nickname, secondary: null };
  }
  return { primary: 'Unnamed player', secondary: null };
}
