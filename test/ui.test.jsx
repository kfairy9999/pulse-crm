import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DashboardView } from '../src/client/pages/Dashboard.jsx';
import Inbox from '../src/client/pages/Inbox.jsx';
import { ContactForm, OpportunityForm, TaskForm, AppointmentForm } from '../src/client/components/Forms.jsx';
import { Workflows } from '../src/client/App.jsx';
import Pipeline, { openPipelineValue, weightedOpenValue } from '../src/client/pages/Pipeline.jsx';
import Tasks from '../src/client/pages/Tasks.jsx';
import Calendar from '../src/client/pages/Calendar.jsx';

const contacts = [{ id: 'c1', name: 'Ava Martinez', first_name: 'Ava', last_name: 'Martinez', company: 'Northstar', tags: ['sample'] }];

test('loaded dashboard renders computed metrics, business priorities, activity and labeled sample data', () => {
  const data = {
    metrics: { openPipeline: 4200, weightedPipeline: 1920, wonValue: 8600, activeContacts: 8, openTasks: 5, dueToday: 2, winRate: 100 },
    monthly: [{ key: '2026-11', month: 'Nov', value: 4200 }],
    tasks: [{ id: 't1', title: 'Review proposal', status: 'Open', priority: 'High', due_date: '2026-11-06', contact_name: 'Ava Martinez' }],
    upcoming: [{ id: 'a1', title: 'Discovery call', starts_at: '2026-11-09T18:00:00.000Z', contact_name: 'Ava Martinez' }],
    activity: [{ id: 'log1', summary: 'Created opportunity', kind: 'opportunity', created_at: '2026-11-06T17:00:00.000Z' }],
    recentContacts: [],
  };
  const markup = renderToStaticMarkup(<DashboardView data={data} navigate={() => {}} openForm={() => {}} sampleDataSeeded toggleTask={() => {}} />);
  assert.match(markup, /Kevin/);
  assert.match(markup, /sample data/);
  assert.match(markup, /\$4\.2K/);
  assert.match(markup, /\$1\.9K weighted/);
  assert.match(markup, /Review proposal/);
  assert.match(markup, /Discovery call/);
  assert.match(markup, /Pipeline movement by record month: Nov \$4,200/);
});

test('forms expose real fields, real contact options and honest schedule boundaries', () => {
  const contact = renderToStaticMarkup(<ContactForm contacts={contacts} onClose={() => {}} onSaved={() => {}} />);
  for (const name of ['first_name', 'last_name', 'email', 'phone', 'company', 'job_title', 'tags']) assert.match(contact, new RegExp(`name="${name}"`));
  assert.match(contact, /Add a contact/);
  assert.doesNotMatch(contact, /method="PATCH"/);
  const opportunity = renderToStaticMarkup(<OpportunityForm record={{ stage: 'Proposal' }} contacts={contacts} onClose={() => {}} onSaved={() => {}} />);
  assert.match(opportunity, /Create an opportunity/);
  assert.match(opportunity, /name="contact_id"/);
  assert.match(opportunity, /name="value"/);
  for (const stage of ['New Lead', 'Contacted', 'Booked', 'Proposal', 'Won', 'Lost']) assert.match(opportunity, new RegExp(`>${stage}</option>`));
  const task = renderToStaticMarkup(<TaskForm contacts={contacts} onClose={() => {}} onSaved={() => {}} />);
  assert.match(task, /name="due_date"/);
  assert.match(task, /name="priority"/);
  const appointment = renderToStaticMarkup(<AppointmentForm contacts={contacts} onClose={() => {}} onSaved={() => {}} />);
  assert.match(appointment, /Local schedule · no calendar invites sent/);
  assert.match(appointment, /name="duration_minutes"/);
  assert.match(appointment, /does not join calls or send invitations/);
});

test('workflows and notes reader never pretend external integrations are active', async () => {
  const workflows = renderToStaticMarkup(<Workflows navigate={() => {}} />);
  assert.match(workflows, /Automations aren’t connected yet/);
  assert.match(workflows, /No pretend automations/);
  assert.match(workflows, /doesn’t send emails, text messages, schedule background jobs/);
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ mode: 'local-notes', externalConnections: [], notes: [{ id: 'n1', contact_id: 'c1', contact_name: 'Ava Martinez', company: 'Northstar', body: 'A sample note, not a message.', author: 'Sample note', created_at: '2026-11-06T17:00:00Z' }] }) });
  const inbox = renderToStaticMarkup(<Inbox openForm={() => {}} notify={() => {}} />);
  assert.match(inbox, /Opening local notes/);
  delete globalThis.fetch;
});

test('the first deal renders on the pipeline and stays visible after a stage change', () => {
  const deal = { id: 'd1', title: 'CRM verification — temporary deal', contact_name: 'CRM verification — temporary', company: 'Verification Co', value: 1, stage: 'New Lead', notes: 'Temporary acceptance-test deal, not a real lead', expected_close_date: null, position: 0 };
  const stagesFor = (stage) => Object.fromEntries(['New Lead', 'Contacted', 'Booked', 'Proposal', 'Won', 'Lost'].map((name) => [name, name === stage ? [{ ...deal, stage }] : []]));
  const props = { openForm() {}, notify() {}, contacts: [] };
  assert.equal(weightedOpenValue(stagesFor('New Lead')), 0.1);
  const first = renderToStaticMarkup(<Pipeline {...props} initialData={{ stages: stagesFor('New Lead'), total: 1 }} />);
  assert.match(first, /CRM verification — temporary deal/);
  assert.match(first, /\$1/);
  assert.match(first, /Opportunity pipeline/);
  assert.match(first, /selected="">New Lead</);
  const moved = renderToStaticMarkup(<Pipeline {...props} initialData={{ stages: stagesFor('Contacted'), total: 1 }} />);
  assert.match(moved, /CRM verification — temporary deal/);
  assert.match(moved, /selected="">Contacted</);
  assert.equal(weightedOpenValue(stagesFor('Contacted')), 0.2);
  assert.doesNotMatch(moved, /selected="">New Lead</);
  const partial = { 'New Lead': stagesFor('New Lead')['New Lead'] };
  assert.equal(openPipelineValue(partial), 1);
  const missingColumns = renderToStaticMarkup(<Pipeline {...props} initialData={{ stages: partial, total: 1 }} />);
  assert.match(missingColumns, /CRM verification — temporary deal/);
  assert.match(missingColumns, /New Lead/);
  assert.match(missingColumns, /Has notes/);
});

test('tasks and schedule screens render saved records', () => {
  const tasks = renderToStaticMarkup(<Tasks openForm={() => {}} notify={() => {}} initialData={{ today: '2026-11-07', counts: { open: 1, highPriority: 1, completed: 0 }, tasks: [{ id: 't1', title: 'CRM verification — temporary task', status: 'Open', priority: 'High', due_date: '2026-12-01', contact_name: 'CRM verification — temporary', notes: 'Temporary acceptance-test task' }] }} />);
  assert.match(tasks, /CRM verification — temporary task/);
  assert.match(tasks, /High/);
  const schedule = renderToStaticMarkup(<Calendar openForm={() => {}} notify={() => {}} navigate={() => {}} initialData={{ appointments: [{ id: 'a1', title: 'CRM verification — temporary appointment', starts_at: '2026-11-15T15:00:00.000Z', duration_minutes: 30, contact_name: 'CRM verification — temporary', location: 'Local only', notes: 'Temporary acceptance-test appointment' }] }} />);
  assert.match(schedule, /CRM verification — temporary appointment/);
  assert.match(schedule, /Local schedule only/);
});

test('no contacts creates a genuine prerequisite for opportunities', () => {
  const markup = renderToStaticMarkup(<OpportunityForm contacts={[]} onClose={() => {}} onSaved={() => {}} />);
  assert.match(markup, /A contact comes first/);
  assert.match(markup, /Every opportunity is linked to a contact/);
});
