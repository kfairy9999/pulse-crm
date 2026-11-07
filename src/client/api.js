export class ApiError extends Error {
  constructor(message, status, fields = {}) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

export async function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function api(path, options = {}) {
  const csrf = document.cookie.split('; ').find((cookie) => cookie.startsWith('__Host-pulse_csrf='))?.split('=').slice(1).join('=');
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(csrf && !['login', 'setup'].some((name) => path.includes(name)) ? { 'X-CSRF-Token': decodeURIComponent(csrf) } : {}), ...options.headers },
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

export const plainDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'No due date';
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return 'No due date';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date);
};

export const localDateKey = (date = new Date()) => {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
};

export function toDateTimeLocal(value) {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

export function fromDateTimeLocal(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return value;
  const [date, time] = value.split('T');
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const local = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (Number.isNaN(local.getTime())) return value;
  return local.toISOString();
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
