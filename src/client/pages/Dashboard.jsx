import { ArrowRight, BriefcaseBusiness, CalendarDays, Check, CheckSquare, CircleDollarSign, Clock3, ContactRound, MessageSquareText, Plus, Sparkles, TrendingUp, UserRound } from 'lucide-react';
import { ErrorState, LoadingState, Avatar, Button, Pill, Tag, TaskCheckbox } from '../components/UI.jsx';
import { money, plainDate, relativeTime, shortDate } from '../api.js';
import { useResource } from '../hooks.js';
import { STAGE_WEIGHTS, ownerCalendarDate } from '../../shared.js';

const activityIcons = { task: CheckSquare, appointment: CalendarDays, opportunity: BriefcaseBusiness, contact: ContactRound, note: MessageSquareText };
const activityColors = { task: 'green', appointment: 'purple', opportunity: 'blue', contact: 'orange', note: 'rose' };

function RevenueChart({ monthly = [] }) {
  const width = 680, height = 230, padX = 40, padTop = 20, padBottom = 38;
  const max = Math.max(...monthly.map((item) => item.value), 1000);
  const x = (index) => padX + index * ((width - padX * 2) / Math.max(monthly.length - 1, 1));
  const y = (value) => padTop + (height - padTop - padBottom) * (1 - value / (max * 1.2));
  const path = monthly.map((item, index) => `${index ? 'L' : 'M'} ${x(index)} ${y(item.value)}`).join(' ');
  return <div className="revenue-chart">
    <div className="chart-heading"><div><span className="eyebrow">At a glance</span><h3>Pipeline movement</h3></div><span className="chart-legend"><span />Open & won value</span></div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Pipeline movement by record month: ${monthly.map((item) => `${item.month} ${money(item.value)}`).join(', ')}`}>
      <defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#c46a3a" stopOpacity=".2" /><stop offset="100%" stopColor="#c46a3a" stopOpacity="0" /></linearGradient></defs>
      {[0, .5, 1].map((portion) => <g key={portion}><line x1={padX} x2={width - padX} y1={y(max * portion)} y2={y(max * portion)} className="chart-grid" /><text x={0} y={y(max * portion) + 4} className="chart-axis">{money(max * portion, true)}</text></g>)}
      {monthly.length > 0 && <><path d={`${path} L ${x(monthly.length - 1)} ${height - padBottom} L ${x(0)} ${height - padBottom} Z`} fill="url(#chart-fill)" /><path d={path} className="chart-line" />{monthly.map((item, index) => <g key={item.key}><circle cx={x(index)} cy={y(item.value)} r={index === monthly.length - 1 ? 5 : 4} className={index === monthly.length - 1 ? 'chart-dot active' : 'chart-dot'} /><text x={x(index)} y={height - 11} textAnchor="middle" className="chart-month">{item.month}</text></g>)}</>}
    </svg>
  </div>;
}

export default function Dashboard(props) {
  const { data, error, loading, reload } = useResource('/dashboard');
  if (loading) return <LoadingState label="Finding your priorities" />;
  if (error) return <ErrorState error={error} retry={reload} />;
  return <DashboardView {...props} data={data} />;
}

export function DashboardView({ data, navigate, openForm, toggleTask, sampleDataSeeded }) {
  const { metrics, tasks, upcoming, activity, monthly, recentContacts } = data;
  const todo = tasks.filter((task) => task.status === 'Open').slice(0, 5);
  const hour = new Date().getHours();
  return <div className="page dashboard-page">
    <div className="dashboard-welcome"><div><span className="eyebrow">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</span><h1>Good {hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'}, Kevin<span className="heading-period">.</span></h1><p>Here’s a calm look at who needs you today.</p></div><Button variant="primary" icon={Plus} onClick={() => openForm('opportunity')}>New opportunity</Button></div>
    {sampleDataSeeded && <div className="sample-notice"><Sparkles size={16} /><span>You’re exploring <strong>sample data</strong> — a safe place to try every workflow.</span><span className="sample-badge">DEMO WORKSPACE</span></div>}
    <section className="metrics-grid" aria-label="Business metrics">
      <article className="metric-card"><div className="metric-card-top"><span className="metric-icon blue"><CircleDollarSign size={19} /></span><span className="metric-caption">Open pipeline</span><TrendingUp size={17} className="metric-trend" /></div><strong>{money(metrics.openPipeline, true)}</strong><p>Across all open opportunities</p><div className="metric-bottom"><span>{money(metrics.weightedPipeline, true)} weighted</span><button onClick={() => navigate('pipeline')}>View pipeline <ArrowRight size={12} /></button></div></article>
      <article className="metric-card"><div className="metric-card-top"><span className="metric-icon green"><Check size={20} /></span><span className="metric-caption">Won revenue</span><span className="metric-kicker">SIGNED</span></div><strong>{money(metrics.wonValue, true)}</strong><p>{metrics.winRate === null ? 'Your first win is waiting' : `${metrics.winRate}% win rate on closed opportunities`}</p><div className="metric-bottom"><span>From your local pipeline</span><button onClick={() => navigate('pipeline')}>See wins <ArrowRight size={12} /></button></div></article>
      <article className="metric-card"><div className="metric-card-top"><span className="metric-icon purple"><ContactRound size={19} /></span><span className="metric-caption">Relationships</span><span className="metric-kicker">TOTAL</span></div><strong>{metrics.activeContacts}</strong><p>People in your contact book</p><div className="metric-bottom"><span>Your whole network</span><button onClick={() => navigate('contacts')}>View contacts <ArrowRight size={12} /></button></div></article>
      <article className="metric-card"><div className="metric-card-top"><span className="metric-icon orange"><CheckSquare size={18} /></span><span className="metric-caption">Open tasks</span>{metrics.dueToday > 0 && <span className="attention-count">{metrics.dueToday} due today</span>}</div><strong>{metrics.openTasks}</strong><p>Next steps across your workspace</p><div className="metric-bottom"><span>Keep your momentum</span><button onClick={() => navigate('tasks')}>View tasks <ArrowRight size={12} /></button></div></article>
    </section>
    <div className="dashboard-main-grid">
      <RevenueChart monthly={monthly} />
      <section className="panel priority-panel"><div className="panel-header"><div><span className="eyebrow">Your next moves</span><h2>Priority tasks</h2></div><button className="text-button" onClick={() => navigate('tasks')}>See all <ArrowRight size={14} /></button></div>
        <div className="dashboard-task-list">{todo.length ? todo.map((task) => <div className="dashboard-task" key={task.id}><TaskCheckbox task={task} onToggle={toggleTask} /><div className="dashboard-task-content"><strong>{task.title}</strong><span>{task.contact_name || 'Personal task'} <span className="middot">·</span> <span className={task.due_date && task.due_date <= ownerCalendarDate() ? 'task-overdue' : ''}>{plainDate(task.due_date)}</span></span></div><Tag tone={task.priority === 'High' ? 'rose' : 'neutral'}>{task.priority}</Tag></div>) : <div className="small-empty"><Check size={19} /><span>You’re clear for the moment. Add a task when you want a nudge.</span><button onClick={() => openForm('task')}>Add a task</button></div>}</div>
      </section>
    </div>
    <div className="dashboard-bottom-grid">
      <section className="panel activity-panel"><div className="panel-header"><div><span className="eyebrow">The latest</span><h2>Recent activity</h2></div><span className="live-indicator"><span />ACTIVITY LOG</span></div><div className="activity-list">{activity.slice(0, 6).map((item) => { const Icon = activityIcons[item.kind] || Sparkles; return <div className="activity-row" key={item.id}><span className={`activity-icon ${activityColors[item.kind] || 'blue'}`}><Icon size={16} /></span><div><p>{item.summary}</p><span>{item.contact_name && <>{item.contact_name} <span className="middot">·</span> </>}{relativeTime(item.created_at)}</span></div></div>; })}{!activity.length && <div className="small-empty">When you add a person, a note, or a deal, the story shows up here.</div>}</div></section>
      <section className="panel upcoming-panel"><div className="panel-header"><div><span className="eyebrow">Make time for people</span><h2>Coming up</h2></div><button className="text-button" onClick={() => navigate('calendar')}>Schedule <ArrowRight size={14} /></button></div>{upcoming.length ? upcoming.slice(0, 3).map((appointment) => <div className="upcoming-item" key={appointment.id}><div className="date-tile"><strong>{new Date(appointment.starts_at).getDate()}</strong><span>{new Date(appointment.starts_at).toLocaleString('en', { month: 'short' })}</span></div><div><strong>{appointment.title}</strong><span><Clock3 size={12} />{shortDate(appointment.starts_at, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</span><span className="local-caption">Local appointment record</span></div></div>) : <div className="small-empty"><CalendarDays size={18} /><span>Nothing on the books yet.</span><button onClick={() => openForm('appointment')}>Add an appointment</button></div>}</section>
    </div>
  </div>;
}
