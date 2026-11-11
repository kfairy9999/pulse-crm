import { useState } from 'react';
import { CalendarClock, Check, CheckSquare, ChevronRight, Circle, Clock3, Edit3, ListChecks, Plus, Trash2 } from 'lucide-react';
import { api, localDateKey, plainDate } from '../api.js';
import { useResource } from '../hooks.js';
import { Avatar, Button, ConfirmDialog, EmptyState, ErrorState, IconButton, LoadingState, Tag, TaskCheckbox } from '../components/UI.jsx';

export default function Tasks({ openForm, notify, revision, initialData = null }) {
  const [filter, setFilter] = useState('Open');
  const [busy, setBusy] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const resource = useResource('/tasks');
  const data = initialData || resource.data;
  const loading = initialData ? false : resource.loading;
  const error = initialData ? null : resource.error;
  const reload = resource.reload;
  const toggleTask = async (task) => {
    setBusy(task.id);
    try { await api(`/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ completed: task.status !== 'Completed' }) }); await reload(true); notify(task.status === 'Completed' ? 'Task reopened.' : 'Task complete — nice work.'); }
    catch (err) { notify(err.message, 'error'); }
    finally { setBusy(null); }
  };
  const groups = [
    { key: 'Overdue', match: (task) => task.status === 'Open' && task.due_date && task.due_date < data.today, title: 'Needs attention', caption: 'Past due', className: 'overdue' },
    { key: 'Today', match: (task) => task.status === 'Open' && task.due_date === data.today, title: 'Today', caption: 'Keep your momentum', className: 'today' },
    { key: 'Upcoming', match: (task) => task.status === 'Open' && (!task.due_date || task.due_date > data.today), title: 'Coming up', caption: 'Looking ahead', className: 'upcoming' },
    { key: 'Completed', match: (task) => task.status === 'Completed', title: 'Completed', caption: 'Progress worth noting', className: 'completed' },
  ];
  return <div className="page">
    <div className="page-heading"><div><span className="eyebrow">Small steps, real momentum</span><h1>Tasks<span className="count-badge">{data?.counts?.open ?? '—'} open</span></h1><p>One clear next step for each person you care about.</p></div><Button variant="primary" icon={Plus} onClick={() => openForm('task', () => reload(true))}>Add task</Button></div>
    {loading ? <LoadingState label="Organizing your next steps" /> : error ? <ErrorState error={error} retry={reload} /> : <>
      <div className="task-summary-row"><button className={filter === 'Open' ? 'summary-filter active' : 'summary-filter'} onClick={() => setFilter('Open')}><span className="summary-filter-icon blue"><ListChecks size={20} /></span><div><strong>{data.counts.open}</strong><span>Open tasks</span></div><ChevronRight size={16} /></button><button className={filter === 'High' ? 'summary-filter active' : 'summary-filter'} onClick={() => setFilter(filter === 'High' ? 'Open' : 'High')}><span className="summary-filter-icon orange"><CalendarClock size={20} /></span><div><strong>{data.counts.highPriority}</strong><span>High priority</span></div><ChevronRight size={16} /></button><button className={filter === 'Completed' ? 'summary-filter active' : 'summary-filter'} onClick={() => setFilter('Completed')}><span className="summary-filter-icon green"><Check size={20} /></span><div><strong>{data.counts.completed}</strong><span>Completed</span></div><ChevronRight size={16} /></button></div>
      <div className="task-tabs"><button className={filter === 'Open' ? 'active' : ''} onClick={() => setFilter('Open')}>To do <span>{data.counts.open}</span></button><button className={filter === 'High' ? 'active' : ''} onClick={() => setFilter('High')}>High priority <span>{data.counts.highPriority}</span></button><button className={filter === 'Completed' ? 'active' : ''} onClick={() => setFilter('Completed')}>Completed <span>{data.counts.completed}</span></button></div>
      {data.tasks.length ? <div className="task-groups">{groups.filter((group) => filter === 'Open' ? group.key !== 'Completed' : filter === 'Completed' ? group.key === 'Completed' : group.key !== 'Completed').map((group) => { const tasks = data.tasks.filter(group.match).filter((task) => filter !== 'High' || task.priority === 'High'); if (!tasks.length) return null; return <section className={`task-group panel ${group.className}`} key={group.key}><div className="task-group-header"><div><h2>{group.title}<span>{tasks.length}</span></h2><p>{group.caption}</p></div>{group.key === 'Overdue' && <Tag tone="rose">Action needed</Tag>}</div><div>{tasks.map((task) => <article className={`task-row ${task.status === 'Completed' ? 'task-is-complete' : ''}`} key={task.id}><TaskCheckbox task={task} onToggle={toggleTask} busy={busy === task.id} /><div className="task-main"><div className="task-title-line"><strong>{task.title}</strong><span className="task-repeat">{task.recurrence ? `Repeats ${task.recurrence}` : 'Does not repeat'}</span></div><div>{task.contact_name && <span>{task.contact_name}</span>}<span><Clock3 size={13} />{plainDate(task.due_date)}</span></div>{task.notes && <p>{task.notes}</p>}</div><Tag tone={task.priority === 'High' ? 'rose' : task.priority === 'Medium' ? 'amber' : 'neutral'}>{task.priority}</Tag><div className="row-actions"><IconButton label={`Edit ${task.title}`} onClick={() => openForm('task', () => reload(true), task)}><Edit3 size={16} /></IconButton><IconButton label={`Delete ${task.title}`} className="danger-icon" onClick={() => setDeleting(task)}><Trash2 size={16} /></IconButton></div></article>)}</div></section>; })}</div> : <div className="panel"><EmptyState icon={CheckSquare} title="A clear list" description="Add a follow-up when you don’t want it to slip. A title and a day are enough." action={<Button variant="primary" icon={Plus} onClick={() => openForm('task', () => reload(true))}>Add a task</Button>} /></div>}
      {!data.tasks.some((task) => data.tasks.filter((item) => filter === 'High' ? item.priority === 'High' && item.status === 'Open' : filter === 'Completed' ? item.status === 'Completed' : item.status === 'Open').length) && data.tasks.length > 0 && <div className="panel"><EmptyState icon={CheckSquare} title="You’re all clear" description={filter === 'Completed' ? 'Completed tasks will collect here.' : 'No tasks match this view.'} /></div>}
    </>}
    {deleting && <ConfirmDialog title="Delete this task?" description={`“${deleting.title}” will be permanently removed from your local workspace.`} busy={Boolean(busy)} onClose={() => setDeleting(null)} onConfirm={async () => { setBusy(deleting.id); try { await api(`/tasks/${deleting.id}`, { method: 'DELETE' }); setDeleting(null); await reload(true); notify('Task deleted.'); } catch (err) { notify(err.message, 'error'); } finally { setBusy(null); } }} />}
  </div>;
}
