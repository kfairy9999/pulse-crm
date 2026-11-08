import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { isoDateTime } from '../src/shared.js';

const losAngeles = (iso) => new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit', hour12: true,
}).format(new Date(iso));

test('a zoneless noon stored as UTC displays as 4:00 AM in Los Angeles', () => {
  assert.equal(isoDateTime('2026-11-07T20:00:00.000Z'), '2026-11-07T20:00:00.000Z');
  assert.equal(losAngeles('2026-11-07T12:00:00.000Z'), '4:00 AM');
  assert.equal(losAngeles('2026-11-07T20:00:00.000Z'), '12:00 PM');
  assert.equal(losAngeles('2026-07-15T19:00:00.000Z'), '12:00 PM');
});

test('appointment entry keeps the Los Angeles wall clock across standard time, daylight time, and midnight', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { fromDateTimeLocal, toDateTimeLocal } from './src/client/api.js';
    const cases = [
      ['2026-11-07T12:00', '2026-11-07T20:00:00.000Z'],
      ['2026-11-07T00:30', '2026-11-07T08:30:00.000Z'],
      ['2026-07-15T12:00', '2026-07-15T19:00:00.000Z'],
      ['2026-03-08T01:30', '2026-03-08T09:30:00.000Z'],
      ['2026-03-08T03:30', '2026-03-08T10:30:00.000Z'],
      ['2026-11-01T00:30', '2026-11-01T07:30:00.000Z'],
      ['2026-11-01T02:30', '2026-11-01T10:30:00.000Z'],
    ];
    for (const [wall, instant] of cases) {
      const stored = fromDateTimeLocal(wall);
      if (stored !== instant) throw new Error('store ' + wall + ' ' + stored);
      if (toDateTimeLocal(stored) !== wall) throw new Error('edit ' + stored + ' ' + toDateTimeLocal(stored));
    }
    if (toDateTimeLocal('2026-11-07T09:00') !== '2026-11-07T09:00') throw new Error('prefill shifted');
  `], { env: { ...process.env, TZ: 'America/Los_Angeles' }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
