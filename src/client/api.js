export class ApiError extends Error {
  constructor(message, status, fields = {}) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

export async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...options.headers },
  });
  let payload;
  try { payload = await response.json(); } catch { payload = {}; }
  if (!response.ok) throw new ApiError(payload.error || `Request failed (${response.status}).`, response.status, payload.fields);
  return payload;
}

export const money = (value = 0, compact = false) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: compact && value >= 1000 ? 1 : 0,
  notation: compact && value >= 1000 ? 'compact' : 'standard',
}).format(value);

export const shortDate = (value, options = {}) => value
  ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', ...options }).format(new Date(value))
  : 'No date';

export const plainDate = (value) => value
  ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`))
  : 'No due date';

export const localDateKey = (date = new Date()) => {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
};

export function toDateTimeLocal(value) {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

export function initials(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
}

export function relativeTime(value) {
  const diff = new Date(value).getTime() - Date.now();
  const abs = Math.abs(diff);
  const units = abs < 3_600_000 ? ['minute', 60_000] : abs < 86_400_000 ? ['hour', 3_600_000] : ['day', 86_400_000];
  return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(Math.round(diff / units[1]), units[0]);
}
