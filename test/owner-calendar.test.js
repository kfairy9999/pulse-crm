import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addCalendarDays,
  dueDate,
  followUpDueDate,
  ownerCalendarDate,
  ownerMonthSeries,
  recordMonthKey,
} from '../src/shared.js';
import { nextDueDate } from '../src/sales.js';

test('a late Pacific evening uses the Los Angeles day for follow-up offsets', () => {
  const sevenFortyFive = '2026-11-08T03:45:00.000Z';
  const sevenFortySeven = '2026-11-08T03:47:00.000Z';
  assert.equal(ownerCalendarDate(sevenFortyFive), '2026-11-07');
  assert.equal(followUpDueDate(0, sevenFortyFive), '2026-11-07');
  assert.equal(followUpDueDate(1, sevenFortyFive), '2026-11-08');
  assert.equal(followUpDueDate(1, sevenFortySeven), '2026-11-08');
  assert.equal(followUpDueDate(1, '2026-11-07T20:00:00.000Z'), '2026-11-08');
});

test('Pacific daylight, spring-forward, and fall-back dates stay on the Los Angeles calendar', () => {
  const summerNight = '2026-07-16T06:30:00.000Z';
  assert.equal(ownerCalendarDate(summerNight), '2026-07-15');
  assert.equal(followUpDueDate(0, summerNight), '2026-07-15');
  assert.equal(followUpDueDate(1, summerNight), '2026-07-16');
  assert.equal(ownerCalendarDate('2026-03-08T09:30:00.000Z'), '2026-03-08');
  assert.equal(ownerCalendarDate('2026-03-08T10:30:00.000Z'), '2026-03-08');
  assert.equal(followUpDueDate(1, '2026-03-08T10:30:00.000Z'), '2026-03-09');
  assert.equal(ownerCalendarDate('2026-11-01T06:30:00.000Z'), '2026-10-31');
  assert.equal(followUpDueDate(1, '2026-11-01T06:30:00.000Z'), '2026-11-01');
  assert.equal(ownerCalendarDate('2026-11-01T07:30:00.000Z'), '2026-11-01');
  assert.equal(ownerCalendarDate('2026-11-01T09:30:00.000Z'), '2026-11-01');
  assert.equal(addCalendarDays('2026-01-31', 1), '2026-02-01');
});

test('stored task dates and weekly recurrence are calendar dates, not clock shifts', () => {
  assert.equal(dueDate('2026-11-09'), '2026-11-09');
  assert.equal(nextDueDate('2026-11-08', 'weekly'), '2026-11-15');
  assert.equal(nextDueDate('2026-11-07', 'weekly'), '2026-11-14');
});

test('today, overdue, and record month use the Los Angeles day', () => {
  const evening = '2026-11-08T03:45:00.000Z';
  const today = ownerCalendarDate(evening);
  assert.equal(today, '2026-11-07');
  assert.equal(addCalendarDays(today, -1) < today, true);
  assert.equal(addCalendarDays(today, 1) > today, true);
  assert.equal(ownerMonthSeries(evening).at(-1).key, '2026-11');
  assert.equal(recordMonthKey('2026-12-01T03:45:00.000Z'), '2026-11');
  assert.equal('2026-11-06' <= ownerCalendarDate('2026-11-08T03:45:00.000Z'), true);
  assert.equal('2026-11-08' <= ownerCalendarDate('2026-11-08T03:45:00.000Z'), false);
});
