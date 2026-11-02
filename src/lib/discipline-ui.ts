import { fmtDateArizona, fmtDateTimeArizona } from './arizona-time';
import { isDisciplineActionEffective } from './discipline';

const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

export function asText(value: unknown) {
  return String(value ?? '').trim();
}

export function actionTypeLabel(value: unknown) {
  const type = asText(typeof value === 'object' && value ? (value as any).action_type : value).toLowerCase();
  if (type === 'strike') return 'Strike';
  if (type === 'suspension') return 'Suspension';
  if (type === 'ban') return 'Ban';
  return type ? type.charAt(0).toUpperCase() + type.slice(1).replaceAll('_', ' ') : 'Action';
}

export function statusLabel(value: unknown) {
  const status = asText(value).toLowerCase();
  if (status === 'ban' || status === 'banned') return 'Banned';
  if (status === 'suspension' || status === 'suspended') return 'Suspended';
  if (status === 'strike' || status === 'strikes') return 'Active strikes';
  return 'Good standing';
}

export function statusTone(value: unknown) {
  const status = asText(value).toLowerCase();
  if (status === 'ban' || status === 'banned') return 'status-ban';
  if (status === 'suspension' || status === 'suspended') return 'status-suspension';
  if (status === 'strike' || status === 'strikes') return 'status-strike';
  return 'status-clear';
}

export function formatIssued(value: unknown) {
  const text = asText(value);
  return text ? fmtDateTimeArizona(text) : '—';
}

export function formatDay(value: unknown) {
  const text = asText(value);
  if (!text) return '—';
  return fmtDateArizona(dateOnlyPattern.test(text) ? `${text}T12:00:00Z` : text);
}

export function isEffective(action: any) {
  try {
    return isDisciplineActionEffective(action);
  } catch {
    return false;
  }
}

export function expiryLabel(action: any) {
  if (action?.expires_on) return `Through ${formatDay(action.expires_on)} (inclusive)`;
  if (asText(action?.action_type).toLowerCase() === 'ban') return 'Permanent';
  return 'No expiration';
}

export function sourceLabel(value: unknown) {
  const text = asText(value);
  if (!text) return 'Manual';
  return text
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
