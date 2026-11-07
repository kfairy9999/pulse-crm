import { useMemo, useState } from 'react';
import { ArrowRight, BriefcaseBusiness, CalendarDays, Check, ChevronDown, CircleDollarSign, Edit3, Filter, GripVertical, LayoutGrid, List, MoreHorizontal, Plus, Sparkles, Trash2, TrendingUp, Trophy, UsersRound } from 'lucide-react';
import { api, money, plainDate, shortDate } from '../api.js';
import { useResource } from '../hooks.js';
import { Avatar, Button, ConfirmDialog, EmptyState, ErrorState, IconButton, LoadingState, Pill, Select, Tag } from '../components/UI.jsx';
import { OPEN_STAGES, PIPELINE_STAGES, STAGE_WEIGHTS } from '../../shared.js';

const stageTone = { 'New Lead': 'blue', Contacted: 'purple', Booked: 'teal', Proposal: 'orange', Won: 'green', Lost: 'gray' };

export function weightedOpenValue(stages) {
  return OPEN_STAGES.reduce((total, stage) => total + (stages[stage] || []).reduce((sum, deal) => sum + deal.value * STAGE_WEIGHTS[stage], 0), 0);
}

export default function Pipeline({ openForm, notify, revision, contacts, initialData = null }) {
  const resource = useResource('/opportunities');
  const data = initialData || resource.data;
  const loading = initialData ? false : resource.loading;
  const error = initialData ? null : resource.error;
  const reload = resource.reload;
  const [query, setQuery] = useState('');
  const [dragId, setDragId] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const [moving, setMoving] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const move = async (opportunityId, stage, position = null) => {
    if (moving) return;
    setMoving(opportunityId);
    try { await api(`/opportunities/${opportunityId}`, { method: 'PATCH', body: JSON.stringify({ stage, ...(position === null ? {} : { position }) }) }); await reload(true); notify(`Opportunity moved to ${stage}.`); }
    catch (err) { notify(err.message, 'error'); }
    finally { setMoving(null); setDragId(null); setDragOver(null); }
  };
  return <div className="page pipeline-page">
    <div className="page-heading"><div><span className="eyebrow">Turn conversations into momentum</span><h1>Pipeline<span className="count-badge">{data?.total ?? '—'}</span></h1><p>Every opportunity has a next step.</p></div><Button variant="primary" icon={Plus} onClick={() => openForm('opportunity', () => reload(true))}>New opportunity</Button></div>
    <div className="pipeline-search"><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter this pipeline…" aria-label="Filter opportunities" /></div>
    {loading ? <LoadingState label="Laying out your pipeline" /> : error ? <ErrorState error={error} retry={reload} /> : <>
      <div className="pipeline-summary"><div><span className="summary-icon blue"><CircleDollarSign size={18} /></span><span><small>Open value</small><strong>{money(OPEN_STAGES.flatMap((stage) => data.stages[stage]).reduce((total, deal) => total + deal.value, 0))}</strong></span></div><div><span className="summary-icon purple"><TrendingUp size={18} /></span><span><small>Weighted forecast</small><strong>{money(weightedOpenValue(data.stages))}</strong></span></div><div><span className="summary-icon green"><Trophy size={18} /></span><span><small>Won</small><strong>{money(data.stages.Won.reduce((total, deal) => total + deal.value, 0))}</strong></span></div><div className="pipeline-instruction"><GripVertical size={17} /><span>Drag cards between stages, or use the stage menu on any card.</span></div></div>
      <div className="pipeline-board" aria-label="Opportunity pipeline">{PIPELINE_STAGES.map((stage) => {
        const deals = data.stages[stage].filter((deal) => `${deal.title} ${deal.contact_name} ${deal.company || ''}`.toLowerCase().includes(query.toLowerCase()));
        return <section className={`pipeline-column stage-${stageTone[stage]} ${dragOver === stage ? 'drag-over' : ''}`} key={stage} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDragOver(stage); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragOver(null); }} onDrop={(event) => { event.preventDefault(); const id = event.dataTransfer.getData('text/plain') || dragId; if (id) move(id, stage); }}>
          <div className="pipeline-column-header"><div><span className={`stage-dot ${stageTone[stage]}`} /><h2>{stage}</h2><span className="stage-count">{deals.length}</span></div><span className="stage-total">{money(deals.reduce((total, deal) => total + deal.value, 0), true)}</span></div>
          <div className="stage-progress"><span style={{ width: `${Math.min(100, stage === 'Won' ? 100 : (STAGE_WEIGHTS[stage] || .03) * 100)}%` }} /></div>
          <div className="deal-list">{deals.map((deal) => <article className={`deal-card ${moving === deal.id ? 'is-moving' : ''}`} key={deal.id} draggable={!moving} onDragStart={(event) => { setDragId(deal.id); event.dataTransfer.setData('text/plain', deal.id); event.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => { setDragId(null); setDragOver(null); }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.stopPropagation(); event.preventDefault(); if (dragId && dragId !== deal.id) move(dragId, stage, deal.position); else if (dragId) setDragOver(null); }}>
            <div className="deal-card-top"><span className="drag-handle" aria-hidden="true"><GripVertical size={16} /></span><span className="deal-probability">{stage === 'Won' ? 'Closed won' : stage === 'Lost' ? 'Closed lost' : `${Math.round(STAGE_WEIGHTS[stage] * 100)}% stage weight`}</span><IconButton label={`Edit ${deal.title}`} onClick={() => openForm('opportunity', () => reload(true), deal)}><Edit3 size={15} /></IconButton></div>
            <h3>{deal.title}</h3><div className="deal-company"><Avatar name={deal.contact_name} size="tiny" /><span>{deal.company || deal.contact_name}</span></div>
            <div className="deal-value">{money(deal.value)}<span>USD</span></div>
            <div className="deal-metadata">{deal.expected_close_date ? <span><CalendarDays size={13} />{plainDate(deal.expected_close_date)}</span> : <span>No close date</span>}{deal.notes && <span title={deal.notes}>Has notes</span>}</div>
            <div className="deal-card-footer"><Select aria-label={`Stage for ${deal.title}`} value={deal.stage} disabled={moving === deal.id} onChange={(event) => move(deal.id, event.target.value)}>{PIPELINE_STAGES.map((name) => <option key={name}>{name}</option>)}</Select><IconButton label={`Delete ${deal.title}`} className="danger-icon" onClick={() => setDeleting(deal)}><Trash2 size={14} /></IconButton></div>
          </article>)}</div>
          {!deals.length && <div className="empty-column"><BriefcaseBusiness size={20} /><span>{query ? 'No matching deals' : 'Ready for your next opportunity'}</span></div>}
          <button className="add-deal-to-stage" onClick={() => openForm('opportunity', () => reload(true), { stage })}><Plus size={14} />Add opportunity</button>
        </section>;
      })}</div>
      <div className="pipeline-footnote"><span className="info-dot">i</span><span>Weighted forecast uses stage planning weights (New Lead 10%, Contacted 20%, Booked 40%, Proposal 60%). This is a planning estimate, not a revenue guarantee.</span></div>
    </>}
    {deleting && <ConfirmDialog title="Delete this opportunity?" description={`“${deleting.title}” and its value will be removed from the pipeline. This cannot be undone.`} busy={busy} onClose={() => setDeleting(null)} onConfirm={async () => { setBusy(true); try { await api(`/opportunities/${deleting.id}`, { method: 'DELETE' }); setDeleting(null); await reload(true); notify('Opportunity deleted.'); } catch (err) { notify(err.message, 'error'); } finally { setBusy(false); } }} />}
  </div>;
}
