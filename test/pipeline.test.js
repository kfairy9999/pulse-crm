import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixture } from './helpers.js';

const createDeal = (request, contactId, title, stage = 'New Lead', value = 1000) => request('/opportunities', { method: 'POST', body: { title, contact_id: contactId, stage, value, expected_close_date: '2027-01-15' }, expectedStatus: 201 }).then((result) => result.payload.opportunity);

test('opportunities support CRUD, monetary totals, and all six curated stages', async (t) => {
  const { request, contact } = await createFixture(t);
  const person = await contact({ company: 'Signal Works' });
  const first = await createDeal(request, person.id, 'Signal rollout');
  assert.equal(first.value, 1000);
  assert.equal(first.value_cents, 100000);
  assert.equal(first.position, 0);
  assert.deepEqual(first.contact_name, 'Test Contact');
  const second = await createDeal(request, person.id, 'Expansion', 'Proposal', 2500.55);
  assert.equal(second.position, 0);
  assert.equal(second.value_cents, 250055);
  const updated = (await request(`/opportunities/${second.id}`, { method: 'PATCH', body: { title: 'Expanded rollout', value: 3250.10, expected_close_date: '', notes: 'Updated context' }, expectedStatus: 200 })).payload.opportunity;
  assert.equal(updated.title, 'Expanded rollout');
  assert.equal(updated.value_cents, 325010);
  assert.equal(updated.expected_close_date, null);
  assert.equal(updated.stage, 'Proposal');
  const board = (await request('/opportunities', { expectedStatus: 200 })).payload;
  assert.deepEqual(Object.keys(board.stages), ['New Lead', 'Contacted', 'Booked', 'Proposal', 'Won', 'Lost']);
  assert.equal(board.stages['New Lead'].length, 1);
  assert.equal(board.stages.Proposal.length, 1);
  assert.equal(board.stages.Proposal[0].value, 3250.1);
  await request(`/opportunities/${first.id}`, { method: 'DELETE', expectedStatus: 200 });
  assert.equal((await request('/opportunities', { expectedStatus: 200 })).payload.stages['New Lead'].length, 0);
});

test('stage changes and card positions are transactional and preserve order', async (t) => {
  const { request, contact } = await createFixture(t);
  const person = await contact();
  const a = await createDeal(request, person.id, 'A');
  const b = await createDeal(request, person.id, 'B');
  const c = await createDeal(request, person.id, 'C');
  assert.deepEqual([a.position, b.position, c.position], [0, 1, 2]);
  await request(`/opportunities/${b.id}`, { method: 'PATCH', body: { stage: 'Contacted' }, expectedStatus: 200 });
  let stages = (await request('/opportunities', { expectedStatus: 200 })).payload.stages;
  assert.deepEqual(stages['New Lead'].map((item) => [item.title, item.position]), [['A', 0], ['C', 1]]);
  assert.deepEqual(stages.Contacted.map((item) => item.title), ['B']);
  await request(`/opportunities/${b.id}`, { method: 'PATCH', body: { stage: 'New Lead', position: 1 }, expectedStatus: 200 });
  stages = (await request('/opportunities', { expectedStatus: 200 })).payload.stages;
  assert.deepEqual(stages['New Lead'].map((item) => [item.title, item.position]), [['A', 0], ['B', 1], ['C', 2]]);
  await request(`/opportunities/${c.id}`, { method: 'PATCH', body: { position: 0 }, expectedStatus: 200 });
  stages = (await request('/opportunities', { expectedStatus: 200 })).payload.stages;
  assert.deepEqual(stages['New Lead'].map((item) => [item.title, item.position]), [['C', 0], ['A', 1], ['B', 2]]);
  await request(`/opportunities/${a.id}`, { method: 'PATCH', body: { stage: 'Won' }, expectedStatus: 200 });
  stages = (await request('/opportunities', { expectedStatus: 200 })).payload.stages;
  assert.equal(stages.Won[0].title, 'A');
  assert.deepEqual(stages['New Lead'].map((item) => [item.title, item.position]), [['C', 0], ['B', 1]]);
  const dashboard = (await request('/dashboard', { expectedStatus: 200 })).payload;
  assert.equal(dashboard.metrics.wonValue, 1000);
  assert.equal(dashboard.metrics.openPipeline, 2000);
  assert.equal(dashboard.metrics.weightedPipeline, 200);
  assert.equal(dashboard.metrics.winRate, 100);
});

test('opportunity inputs reject invalid stages, values, relations, dates and ordering', async (t) => {
  const { request, contact } = await createFixture(t);
  const person = await contact();
  const deal = await createDeal(request, person.id, 'Reliable deal');
  await request(`/opportunities/${deal.id}`, { method: 'PATCH', body: { stage: 'Invalid stage' }, expectedStatus: 400 });
  await request(`/opportunities/${deal.id}`, { method: 'PATCH', body: { value: -1 }, expectedStatus: 400 });
  await request(`/opportunities/${deal.id}`, { method: 'PATCH', body: { contact_id: 'missing-contact' }, expectedStatus: 400 });
  await request(`/opportunities/${deal.id}`, { method: 'PATCH', body: { expected_close_date: '2026-02-30' }, expectedStatus: 400 });
  await request(`/opportunities/${deal.id}`, { method: 'PATCH', body: { position: -1 }, expectedStatus: 400 });
  await request('/opportunities/missing', { method: 'DELETE', expectedStatus: 404 });
  const unchanged = (await request('/opportunities', { expectedStatus: 200 })).payload.stages['New Lead'][0];
  assert.equal(unchanged.title, 'Reliable deal');
  assert.equal(unchanged.value, 1000);
  assert.equal(unchanged.stage, 'New Lead');
});
