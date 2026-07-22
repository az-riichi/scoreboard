import { describe, expect, it } from 'vitest';
import { composePlayerDisplayName, composeSeasonNameParts } from './player-name';

describe('player name privacy', () => {
  it('uses only fields explicitly marked public', () => {
    const player = {
      display_name: 'Hidden nickname',
      real_first_name: 'Visible',
      real_last_name: 'Hidden surname',
      show_display_name: false,
      show_real_first_name: true,
      show_real_last_name: false
    };

    expect(composePlayerDisplayName(player)).toBe('Visible');
    expect(composeSeasonNameParts(player)).toEqual({ primary: 'Visible', secondary: null });
  });

  it('keeps a public nickname secondary to a public real name', () => {
    const player = {
      display_name: 'Nickname',
      real_first_name: 'First',
      real_last_name: 'Last',
      show_display_name: true,
      show_real_first_name: true,
      show_real_last_name: true
    };

    expect(composeSeasonNameParts(player)).toEqual({ primary: 'First Last', secondary: 'Nickname' });
  });

  it('never falls back to hidden identity fields', () => {
    const player = {
      display_name: 'Secret nickname',
      real_first_name: 'Secret',
      real_last_name: 'Person',
      show_display_name: false,
      show_real_first_name: false,
      show_real_last_name: false
    };

    expect(composePlayerDisplayName(player)).toBe('Unnamed player');
    expect(composeSeasonNameParts(player)).toEqual({ primary: 'Unnamed player', secondary: null });
  });
});
