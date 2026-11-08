export const PIPELINE_STAGES = ['New Lead', 'Contacted', 'Booked', 'Proposal', 'Won', 'Lost'];
export const OPEN_STAGES = PIPELINE_STAGES.filter((stage) => !['Won', 'Lost'].includes(stage));
export const STAGE_WEIGHTS = { 'New Lead': 0.1, Contacted: 0.2, Booked: 0.4, Proposal: 0.6, Won: 1, Lost: 0 };
export const TASK_PRIORITIES = ['Low', 'Medium', 'High'];
export const TASK_STATUSES = ['Open', 'Completed'];

export class DomainError extends Error {
  constructor(message, status = 400, fields = undefined) {
    super(message);
    this.name = 'DomainError';
    this.status = status;
    this.fields = fields;
  }
}

export const fail = (message, status = 400, fields = undefined) => {
  throw new DomainError(message, status, fields);
};

export function requiredText(value, field, max = 160) {
  if (typeof value !== 'string' || !value.trim()) fail(`${field} is required.`, 400, { [field]: `${field} is required.` });
  const text = value.trim();
  if (text.length > max) fail(`${field} must be ${max} characters or fewer.`);
  return text;
}

export function optionalText(value, field, max = 2000) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') fail(`${field} must be text.`);
  const text = value.trim();
  if (text.length > max) fail(`${field} must be ${max} characters or fewer.`);
  return text || null;
}

export function optionalEmail(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
    fail('Enter a valid email address.');
  }
  return value.trim().toLowerCase();
}

export function optionalPhone(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^[+()\d\s.x-]{7,32}$/.test(value.trim())) fail('Enter a valid phone number.');
  return value.trim();
}

export function cleanTags(value) {
  if (value === undefined || value === null || value === '') return [];
  if (typeof value === 'string') value = value.split(',');
  if (!Array.isArray(value)) fail('Tags must be a list of 12 or fewer.');
  const tags = [];
  for (const tag of value) {
    if (typeof tag === 'string' && !tag.trim()) continue;
    tags.push(requiredText(tag, 'Tag', 32));
  }
  if (tags.length > 12) fail('Tags must be a list of 12 or fewer.');
  return [...new Set(tags.map((tag) => tag.toLowerCase()))];
}

export function moneyToCents(value, required = false) {
  if (value === '' || value === null || value === undefined) {
    if (required) fail('Value is required.');
    return 0;
  }
  if (typeof value === 'boolean' || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1_000_000_000) {
    fail('Value must be a positive number no greater than $1,000,000,000.');
  }
  return Math.round(Number(value) * 100);
}

export function isoDateTime(value, field = 'Start time') {
  if (typeof value !== 'string' || !value.trim() || !Number.isFinite(Date.parse(value))) fail(`${field} must be a valid date and time.`);
  return new Date(value).toISOString();
}

export const OWNER_TIME_ZONE = "America/Los_Angeles";

export function ownerCalendarDate(instant = new Date()) {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: OWNER_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value;
  const year = pick("year");
  const month = pick("month");
  const day = pick("day");
  if (!year || !month || !day) return null;
  return `${year}-${month}-${day}`;
}

export function addCalendarDays(isoDate, days) {
  if (typeof isoDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.toISOString().slice(0, 10) !== isoDate) return null;
  const offset = Number(days);
  if (!Number.isFinite(offset)) return null;
  date.setUTCDate(date.getUTCDate() + Math.trunc(offset));
  return date.toISOString().slice(0, 10);
}

export function followUpDueDate(dueInDays, instant = new Date()) {
  const days = Number(dueInDays);
  const offset = Number.isFinite(days) ? Math.min(90, Math.max(0, Math.trunc(days))) : 0;
  return addCalendarDays(ownerCalendarDate(instant), offset);
}

export function shiftCalendarMonths(yearMonth, delta) {
  const match = /^(\d{4})-(\d{2})$/.exec(yearMonth || "");
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + Number(delta), 1));
  return date.toISOString().slice(0, 7);
}

export function ownerMonthSeries(instant = new Date(), length = 6) {
  const current = ownerCalendarDate(instant)?.slice(0, 7);
  return Array.from({ length }, (_, index) => {
    const key = shiftCalendarMonths(current, index - (length - 1));
    const [year, month] = key.split("-").map(Number);
    return {
      key,
      month: new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en", { month: "short", timeZone: "UTC" }),
    };
  });
}

export function recordMonthKey(instant) {
  return ownerCalendarDate(instant)?.slice(0, 7) || null;
}

export function pipelineMonthBuckets(records, instant = new Date()) {
  return ownerMonthSeries(instant).map((bucket) => ({
    ...bucket,
    value: records
      .filter((item) => item.stage !== "Lost" && recordMonthKey(item.updated_at) === bucket.key)
      .reduce((sum, item) => sum + item.value_cents, 0) / 100,
  }));
}

export function dueDate(value) {
  if (value === '' || value === null || value === undefined) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    fail('Due date must be a valid date in YYYY-MM-DD format.');
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (date.toISOString().slice(0, 10) !== value) fail('Due date must be a valid date.');
  return value;
}

export function choice(value, allowed, field) {
  if (!allowed.includes(value)) fail(`${field} must be one of: ${allowed.join(', ')}.`);
  return value;
}

export function booleanValue(value, field = 'Completed') {
  if (typeof value !== 'boolean') fail(`${field} must be true or false.`);
  return value;
}

export function positiveInteger(value, field, max = 100) {
  const integer = Number(value);
  if (!Number.isInteger(integer) || integer < 1 || integer > max) fail(`${field} must be a whole number between 1 and ${max}.`);
  return integer;
}
