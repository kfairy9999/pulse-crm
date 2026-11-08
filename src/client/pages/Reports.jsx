import { useState } from 'react';
import { PieChart, Plus, Trash2 } from 'lucide-react';
import { api, money } from '../api.js';
import { useResource } from '../hooks.js';
import { Button, EmptyState, ErrorState, FormField, IconButton, LoadingState, Select } from '../components/UI.jsx';
import { PIPELINE_STAGES, TASK_PRIORITIES } from '../../shared.js';

export default function Reports({ notify }) {
  const report = useResource('/reports');
  const rules = useResource('/stage-rules');
  const [draft, setDraft] = useState({ stage: 'Proposal', title: 'Send the proposal', dueInDays: 2, priority: 'High' });
  const saveRule = async (event) => {
    event.preventDefault();
    try {
      await api('/stage-rules', { method: 'POST', body: JSON.stringify(draft) });
      await rules.reload(true);
      notify('Follow-up rule saved. It creates a local task only.');
    } catch (error) { notify(error.message, 'error'); }
  };
  const data = report.data;
  return <div className="page">
    <div className="page-heading"><div><span className="eyebrow">From your records</span><h1>Reports</h1><p>Pipeline, wins, and follow-ups stored in this workspace. Nothing is emailed or synced.</p></div></div>
    {report.loading ? <LoadingState label="Adding up your records" /> : report.error ? <ErrorState error={report.error} retry={report.reload} /> : <>
      <section className="metrics-grid" aria-label="Sales totals">
        <article className="metric-card"><span className="metric-caption">Won</span><strong>{money(data.won.value, true)}</strong><p>{data.won.deals} closed won</p></article>
        <article className="metric-card"><span className="metric-caption">Lost</span><strong>{data.lost.deals}</strong><p>{data.winRate === null ? 'No closed deals yet' : `${data.winRate}% win rate`}</p></article>
        <article className="metric-card"><span className="metric-caption">Overdue follow-ups</span><strong>{data.overdueFollowUps}</strong><p>{data.dueToday} due today</p></article>
        <article className="metric-card"><span className="metric-caption">Companies</span><strong>{data.companies.length}</strong><p>Grouped from contact company names</p></article>
      </section>
      <section className="panel" style={{ padding: 16, marginBottom: 16 }}>
        <h2>Pipeline by stage</h2>
        <ul className="report-stages">{PIPELINE_STAGES.map((stage) => <li key={stage}><span>{stage}</span><span><strong>{data.stages[stage].deals}</strong> deals</span><span>{money(data.stages[stage].value)}</span></li>)}</ul>
        <p className="muted">{data.note}</p>
      </section>
      <section className="panel" style={{ padding: 16, marginBottom: 16 }}>
        <h2>Companies</h2>
        {data.companies.length ? <ul>{data.companies.map((row) => <li key={row.company}>{row.company} · {row.contacts}</li>)}</ul> : <EmptyState icon={PieChart} title="No companies yet" description="Add a company on a contact to see it grouped here." />}
      </section>
    </>}
    <section className="panel" style={{ padding: 16 }}>
      <h2>Deal follow-up rules</h2>
      <p className="muted">Saved rules are listed here. An active rule adds one local task when a deal enters its stage. Pause leaves the rule inactive. Delete removes it. Do not save a rule for a stage you are about to use unless you want that task.</p>
      {rules.data && !rules.data.rules.length ? <p>No follow-up rules. Moving a deal will not create a task.</p> : null}
      <ul className="report-stages" aria-label="Saved follow-up rules">{rules.data?.rules?.map((rule) => <li key={rule.id}><span>{rule.stage}: {rule.title}</span><span>{rule.enabled === false ? 'Paused' : 'Active'}</span><span><Button onClick={async () => { await api(`/stage-rules/${rule.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: rule.enabled === false }) }); rules.reload(true); }}>{rule.enabled === false ? 'Turn on' : 'Pause'}</Button><IconButton label={`Delete ${rule.title}`} onClick={async () => { await api(`/stage-rules/${rule.id}`, { method: 'DELETE' }); rules.reload(true); }}><Trash2 size={14} /></IconButton></span></li>)}</ul>
      <form onSubmit={saveRule} className="form-grid">
        <FormField label="Stage"><Select name="stage" value={draft.stage} onChange={(event) => setDraft({ ...draft, stage: event.target.value })}>{PIPELINE_STAGES.map((stage) => <option key={stage}>{stage}</option>)}</Select></FormField>
        <FormField label="Local task"><input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} required maxLength={180} /></FormField>
        <FormField label="Due in days"><input type="number" min="0" max="90" value={draft.dueInDays} onChange={(event) => setDraft({ ...draft, dueInDays: Number(event.target.value) })} /></FormField>
        <FormField label="Priority"><Select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value })}>{TASK_PRIORITIES.map((priority) => <option key={priority}>{priority}</option>)}</Select></FormField>
        <Button variant="primary" type="submit" icon={Plus}>Save rule</Button>
      </form>
    </section>
  </div>;
}
