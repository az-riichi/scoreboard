import { describe, expect, it } from 'vitest';
import {
  addDisciplineCalendarDays,
  disciplineExpiresOn,
  isDisciplineActionEffective,
  isEligibleForCompetitivePlay,
  summarizeDiscipline,
  summarizeDisciplineByPlayer,
  toArizonaDate,
  type DisciplineActionRow,
  type DisciplineActionType
} from './discipline';

let nextId = 1;

function action(
  action_type: DisciplineActionType,
  effective_on: string,
  overrides: Partial<DisciplineActionRow> = {}
): DisciplineActionRow {
  return {
    id: `action-${nextId++}`,
    player_id: 'player-1',
    action_type,
    issued_at: `${effective_on}T19:00:00.000Z`,
    effective_on,
    expires_on: disciplineExpiresOn(action_type, effective_on),
    revoked_at: null,
    ...overrides
  };
}

describe('Arizona discipline calendar dates', () => {
  it('uses the Arizona date on either side of local midnight', () => {
    expect(toArizonaDate('2026-07-22T06:59:59.999Z')).toBe('2026-07-21');
    expect(toArizonaDate('2026-07-22T07:00:00.000Z')).toBe('2026-07-22');
  });

  it('adds calendar days across month, year, and leap-day boundaries', () => {
    expect(addDisciplineCalendarDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDisciplineCalendarDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDisciplineCalendarDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('computes inclusive strike and suspension end dates', () => {
    expect(disciplineExpiresOn('strike', '2026-07-22')).toBe('2026-08-20');
    expect(disciplineExpiresOn('suspension', '2026-07-22')).toBe('2026-08-04');
    expect(disciplineExpiresOn('ban', '2026-07-22')).toBeNull();
  });
});

describe('discipline action boundaries', () => {
  it('keeps a strike effective for D through D+29 inclusive', () => {
    const strike = action('strike', '2026-07-22');

    expect(isDisciplineActionEffective(strike, '2026-07-21')).toBe(false);
    expect(isDisciplineActionEffective(strike, '2026-07-22')).toBe(true);
    expect(isDisciplineActionEffective(strike, '2026-08-20')).toBe(true);
    expect(isDisciplineActionEffective(strike, '2026-08-21')).toBe(false);
  });

  it('keeps a suspension effective for 14 total dates, D through D+13', () => {
    const suspension = action('suspension', '2026-07-22');

    expect(isDisciplineActionEffective(suspension, '2026-07-21')).toBe(false);
    expect(isDisciplineActionEffective(suspension, '2026-07-22')).toBe(true);
    expect(isDisciplineActionEffective(suspension, '2026-08-04')).toBe(true);
    expect(isDisciplineActionEffective(suspension, '2026-08-05')).toBe(false);
  });

  it('keeps a ban effective indefinitely after its effective date', () => {
    const ban = action('ban', '2026-07-22');

    expect(isDisciplineActionEffective(ban, '2026-07-21')).toBe(false);
    expect(isDisciplineActionEffective(ban, '2026-07-22')).toBe(true);
    expect(isDisciplineActionEffective(ban, '2126-07-22')).toBe(true);
  });

  it('treats a revoked row as ineffective at every reference date', () => {
    const revoked = action('ban', '2026-07-22', { revoked_at: '2026-08-01T18:00:00.000Z' });

    expect(isDisciplineActionEffective(revoked, '2026-07-22')).toBe(false);
    expect(isDisciplineActionEffective(revoked, '2026-08-02')).toBe(false);
  });
});

describe('discipline summaries and eligibility', () => {
  it('counts only currently effective, non-revoked strikes', () => {
    const rows = [
      action('strike', '2026-07-01'),
      action('strike', '2026-07-02'),
      action('strike', '2026-07-03', { revoked_at: '2026-07-04T19:00:00.000Z' }),
      action('strike', '2026-06-01')
    ];

    const summary = summarizeDiscipline(rows, '2026-07-30');
    expect(summary.status).toBe('eligible');
    expect(summary.activeStrikeCount).toBe(2);
    expect(summary.currentAction).toBeNull();
  });

  it('counts all non-revoked suspensions even when expired or future', () => {
    const rows = [
      action('suspension', '2026-01-01'),
      action('suspension', '2027-01-01'),
      action('suspension', '2026-02-01', { revoked_at: '2026-02-02T19:00:00.000Z' })
    ];

    const summary = summarizeDiscipline(rows, '2026-07-22');
    expect(summary.suspensionCount).toBe(2);
    expect(summary.status).toBe('eligible');
  });

  it('uses the active suspension with the latest inclusive end date', () => {
    const shorter = action('suspension', '2026-07-20');
    const longer = action('suspension', '2026-07-22');

    const summary = summarizeDiscipline([longer, shorter], '2026-07-23');
    expect(summary.status).toBe('suspended');
    expect(summary.currentAction).toBe(longer);
    expect(isEligibleForCompetitivePlay([longer, shorter], '2026-07-23')).toBe(false);
  });

  it('gives an active ban precedence over suspensions', () => {
    const ban = action('ban', '2026-07-01');
    const suspension = action('suspension', '2026-07-22');
    const strike = action('strike', '2026-07-22');

    const summary = summarizeDiscipline([suspension, ban, strike], '2026-07-23');
    expect(summary.status).toBe('banned');
    expect(summary.activeStrikeCount).toBe(1);
    expect(summary.suspensionCount).toBe(1);
    expect(summary.currentAction).toBe(ban);
  });

  it('restores eligibility when controlling actions are revoked or expired', () => {
    const expired = action('suspension', '2026-07-01');
    const revokedBan = action('ban', '2026-07-01', { revoked_at: '2026-07-02T19:00:00.000Z' });

    expect(isEligibleForCompetitivePlay([expired, revokedBan], '2026-07-22')).toBe(true);
  });

  it('groups independent summaries by player', () => {
    const playerOneBan = action('ban', '2026-07-01');
    const playerTwoStrike = action('strike', '2026-07-01', { player_id: 'player-2' });

    const summaries = summarizeDisciplineByPlayer([playerOneBan, playerTwoStrike], '2026-07-02');
    expect(summaries.get('player-1')?.status).toBe('banned');
    expect(summaries.get('player-2')).toMatchObject({ status: 'eligible', activeStrikeCount: 1 });
  });
});
