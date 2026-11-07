import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowRight, Bell, BriefcaseBusiness, CalendarDays, Check, CheckCircle2, CheckSquare, ChevronDown, CircleHelp, ContactRound, Inbox, LayoutDashboard, LoaderCircle, LogOut, Menu, PanelLeftClose, PieChart, Plus, Search, Settings2, ShieldCheck, Sparkles, UsersRound, WifiOff, X, XCircle } from 'lucide-react';
import Dashboard from './pages/Dashboard.jsx';
import Contacts from './pages/Contacts.jsx';
import Pipeline from './pages/Pipeline.jsx';
import Tasks from './pages/Tasks.jsx';
import Calendar from './pages/Calendar.jsx';
import InboxPage from './pages/Inbox.jsx';
import Reports from './pages/Reports.jsx';
import { AppointmentForm, ContactForm, OpportunityForm, TaskForm } from './components/Forms.jsx';
import { Avatar, Button, ErrorState, IconButton, Modal, SearchInput } from './components/UI.jsx';
import { api } from './api.js';
import AuthGate from './AuthGate.jsx';

const navigation = [
  { id: 'dashboard', label: 'Overview', icon: LayoutDashboard, group: 'Workspace' },
  { id: 'contacts', label: 'Contacts', icon: ContactRound },
  { id: 'pipeline', label: 'Pipeline', icon: BriefcaseBusiness },
  { id: 'tasks', label: 'Tasks', icon: CheckSquare },
  { id: 'calendar', label: 'Schedule', icon: CalendarDays },
  { id: 'reports', label: 'Reports', icon: PieChart },
  { id: 'inbox', label: 'Inbox', icon: Inbox, badge: 'Local' },
  { id: 'workflows', label: 'Workflows', icon: Activity, group: 'Automation' },
];
const pageTitles = { dashboard: 'Overview', contacts: 'Contacts', pipeline: 'Pipeline', tasks: 'Tasks', calendar: 'Schedule', reports: 'Reports', inbox: 'Inbox · Local notes', workflows: 'Workflows' };

class PageBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) return <ErrorState error={this.state.error} retry={() => this.setState({ error: null })} />;
    return this.props.children;
  }
}
const validPages = Object.keys(pageTitles);

export function useHashPage() {
  const get = () => { const page = window.location.hash.replace(/^#\/?/, '').split('/')[0]; return validPages.includes(page) ? page : 'dashboard'; };
  const [page, setPage] = useState(get);
  useEffect(() => { const onChange = () => setPage(get()); window.addEventListener('hashchange', onChange); return () => window.removeEventListener('hashchange', onChange); }, []);
  const navigate = useCallback((next) => { window.location.hash = `/${next}`; setPage(next); }, []);
  return [page, navigate];
}

function GlobalSearch({ contacts, navigate, searchContacts }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const results = useMemo(() => {
    const normalized = query.toLowerCase().trim();
    if (!normalized) return [];
    return [
      ...contacts.filter((contact) => `${contact.name} ${contact.company || ''} ${contact.email || ''}`.toLowerCase().includes(normalized)).slice(0, 5).map((contact) => ({ type: 'contact', id: contact.id, title: contact.name, caption: contact.company || contact.email, icon: ContactRound })),
      ...navigation.filter((item) => !query.trim() || item.label.toLowerCase().includes(normalized)).slice(0, 3).map((item) => ({ type: 'page', id: item.id, title: item.label, caption: 'Go to workspace', icon: item.icon })),
    ].slice(0, 6);
  }, [contacts, query]);
  return <div className="global-search" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    <Search size={17} /><input aria-label="Search contacts" value={query} placeholder="Search contacts…" onFocus={() => setFocused(true)} onChange={(event) => { const value = event.target.value; setQuery(value); setFocused(true); }} onKeyDown={(event) => { if (event.key === 'Enter' && query.trim()) { searchContacts(query); setFocused(false); } if (event.key === 'Escape') { setFocused(false); setQuery(''); } }} /><kbd>⌘ K</kbd>
    {focused && query.trim() && <div className="search-results">{results.length ? results.map((result) => <button key={`${result.type}-${result.id}`} onClick={() => { if (result.type === 'page') navigate(result.id); else searchContacts(result.title); setQuery(''); setFocused(false); }}><span><result.icon size={16} /></span><div><strong>{result.title}</strong><small>{result.caption}</small></div><ArrowRight size={14} /></button>) : <div className="search-no-results">No matching contacts. Press Enter to search the full contact book.</div>}</div>}
  </div>;
}

function WorkspaceInfo({ onClose, sampleDataSeeded, protectedMode }) {
  return <Modal title="A focused CRM, built for momentum" eyebrow="About this workspace" onClose={onClose}><div className="workspace-info"><div className="info-symbol"><ShieldCheck size={27} /></div><h3>{protectedMode ? 'Private. Protected. Ready for work.' : 'Local by design. Clear by default.'}</h3><p>Your contacts, opportunities, tasks, notes, and appointments persist in your workspace database.</p><div className="info-list"><div><Check size={16} /><span>{protectedMode ? 'Owner authentication and secure HTTPS sessions' : 'Cloudflare D1 · no external integrations'}</span></div><div><Check size={16} /><span>No external account sync or application-managed backup</span></div><div><Check size={16} /><span>No email, messaging, or calendar integrations</span></div><div><Check size={16} /><span>No automated workflows or background sending</span></div></div>{sampleDataSeeded && <div className="callout"><Sparkles size={16} /><p>Sample people and companies are fictional workspace data. They are not imported from your personal accounts.</p></div>}<p className="small-print">Back up the D1 database regularly. Provider storage needs a separate, verified recovery plan; it cannot prevent every possible loss.</p></div></Modal>;
}

export function Workflows({ navigate }) {
  return <div className="page"><div className="page-heading"><div><span className="eyebrow">Automation, when it’s real</span><h1>Workflows<span className="count-badge">Not connected</span></h1><p>No pretend automations. Just the core tools that work today.</p></div><Button variant="primary" icon={Plus} onClick={() => navigate('tasks')}>Create a follow-up</Button></div><div className="workflow-empty panel"><span className="workflow-empty-art"><Activity size={33} /><span>↗</span></span><span className="eyebrow">A deliberate boundary</span><h2>Automations aren’t connected yet</h2><p>Pulse doesn’t send emails, text messages, schedule background jobs, or trigger external actions. Until those integrations are genuine, this workspace stays intentionally quiet.</p><div className="workflow-alternatives"><div><CheckSquare size={20} /><h3>Keep a next step</h3><p>Create a task with an owner-ready due date.</p><Button onClick={() => navigate('tasks')}>Go to tasks <ArrowRight size={15} /></Button></div><div><CalendarDays size={20} /><h3>Make time to connect</h3><p>Record an appointment on your local schedule.</p><Button onClick={() => navigate('calendar')}>Open schedule <ArrowRight size={15} /></Button></div><div><Inbox size={20} /><h3>Remember the context</h3><p>Add a local note to the contact it belongs to.</p><Button onClick={() => navigate('contacts')}>Find a contact <ArrowRight size={15} /></Button></div></div></div></div>;
}

function Workspace({ owner, onLogout }) {
  const [page, navigate] = useHashPage();
  const [metadata, setMetadata] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [form, setForm] = useState(null);
  const [revision, setRevision] = useState(0);
  const [toast, setToast] = useState(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [contactSearch, setContactSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef(null);
  const notify = useCallback((message, type = 'success') => setToast({ message, type, key: Date.now() }), []);
  const refreshContacts = useCallback(async () => { try { setContacts((await api('/contacts')).contacts); } catch { /* Individual views show API errors. */ } }, []);
  useEffect(() => { api('/metadata').then(setMetadata).catch((error) => notify(error.message, 'error')); }, [notify]);
  useEffect(() => { refreshContacts(); }, [refreshContacts, revision]);
  useEffect(() => { setMobileNav(false); setSearchOpen(false); window.scrollTo({ top: 0, behavior: 'instant' }); }, [page]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const handler = (event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setSearchOpen(true); } };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);
  useEffect(() => { if (searchOpen) setTimeout(() => searchRef.current?.querySelector('input')?.focus(), 40); }, [searchOpen]);
  const openForm = useCallback((type, afterSave, record = null) => setForm({ type, afterSave, record }), []);
  const finishSave = async (isDelete = false) => { setForm(null); setRevision((value) => value + 1); await refreshContacts(); await form?.afterSave?.(); if (!isDelete) notify({ contact: form.record?.id ? 'Contact updated.' : 'Contact added.', opportunity: form.record?.id ? 'Opportunity updated.' : 'Opportunity created.', task: form.record?.id ? 'Task updated.' : 'Task added.', appointment: form.record?.id ? 'Appointment updated.' : 'Appointment saved locally.' }[form.type]); };
  const searchContacts = (query) => { setContactSearch(query); navigate('contacts'); };
  const toggleTask = async (task) => { try { await api(`/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ completed: task.status !== 'Completed' }) }); setRevision((value) => value + 1); notify(task.status === 'Completed' ? 'Task reopened.' : 'Task complete — nice work.'); } catch (error) { notify(error.message, 'error'); } };
  const common = { openForm, notify, navigate, contacts };
  return <div className="app-shell">
    {mobileNav && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <aside className={`sidebar ${mobileNav ? 'sidebar-mobile-open' : ''}`}><div className="brand"><span className="brand-symbol"><svg width="31" height="29" viewBox="0 0 36 30" fill="none"><path d="M2 16h7l4-10 8 21 5-14h8" stroke="currentColor" strokeWidth="3.3" strokeLinecap="round" strokeLinejoin="round" /></svg></span><span className="brand-name">pulse<span>.</span></span><span className="brand-crm">CRM</span><IconButton className="mobile-nav-close" label="Close navigation" onClick={() => setMobileNav(false)}><X size={19} /></IconButton></div><div className="workspace-switch"><Avatar name="Kevin Fairley" size="small" /><div><strong>Kevin’s workspace</strong><span>Personal · {owner ? 'Protected' : 'Local'}</span></div><ChevronDown size={14} /></div><nav className="main-navigation" aria-label="Main navigation">{navigation.map((item, index) => <div key={item.id}>{item.group && <span className="nav-group-title">{item.group}</span>}<button className={`nav-item ${page === item.id ? 'active' : ''}`} aria-current={page === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><item.icon size={19} strokeWidth={page === item.id ? 2.1 : 1.65} /><span>{item.label}</span>{item.badge && <span className="nav-badge">{item.badge}</span>}{item.id === 'workflows' && <span className="nav-soon">—</span>}</button></div>)}</nav><div className="sidebar-bottom"><div className="local-status"><span className="local-status-icon"><ShieldCheck size={16} /></span><div><strong>{owner ? 'Private, protected workspace' : 'Local workspace'}</strong><span>{owner ? 'Owner-only sign in' : 'Persisted on your database'}</span></div></div><button className="nav-item" onClick={() => setAboutOpen(true)}><CircleHelp size={18} /><span>Workspace info</span></button><div className="profile"><Avatar name="Kevin Fairley" size="small" /><div><strong>Kevin Fairley</strong><span>Workspace owner</span></div><span className="online-dot" title="Workspace online" /></div></div></aside>
    <div className="main-shell"><header className="app-topbar"><div className="topbar-page"><IconButton className="mobile-menu-button" label="Open navigation" onClick={() => setMobileNav(true)}><Menu size={20} /></IconButton><span>{pageTitles[page]}</span><span className="topbar-breadcrumb">/ Kevin’s workspace</span></div><>{owner && <Button onClick={onLogout} icon={LogOut}>Sign out</Button>}</><div ref={searchRef} className={`desktop-global-search ${searchOpen ? 'force-visible' : ''}`}><GlobalSearch contacts={contacts} navigate={navigate} searchContacts={searchContacts} /></div><div className="topbar-right"><span className="local-topbar-label"><span />{owner ? 'PROTECTED' : 'LOCAL MVP'}</span><IconButton className="mobile-search-button" label="Search contacts" onClick={() => setSearchOpen((value) => !value)}><Search size={19} /></IconButton><Button variant="primary" className="quick-add-button" icon={Plus} onClick={() => openForm(page === 'calendar' ? 'appointment' : page === 'tasks' ? 'task' : page === 'contacts' ? 'contact' : 'opportunity')}>Quick add<ChevronDown size={14} className="quick-add-chevron" /></Button></div></header><main className={page === 'pipeline' ? 'pipeline-main' : ''}><PageBoundary key={page}>{page === 'dashboard' ? <Dashboard key={revision} {...common} sampleDataSeeded={metadata?.sampleDataSeeded} toggleTask={toggleTask} /> : page === 'contacts' ? <Contacts key={revision} {...common} search={contactSearch} setSearch={setContactSearch} /> : page === 'pipeline' ? <Pipeline key={revision} {...common} /> : page === 'tasks' ? <Tasks key={revision} {...common} /> : page === 'calendar' ? <Calendar key={revision} {...common} /> : page === 'reports' ? <Reports key={revision} {...common} /> : page === 'inbox' ? <InboxPage key={revision} {...common} /> : <Workflows navigate={navigate} />}</PageBoundary></main><footer className="app-footer"><span>Pulse CRM <span className="middot">·</span> Built for your next conversation.</span><span><span className="footer-dot" />Cloudflare D1 <span className="middot">·</span> No external sending</span></footer></div>
    {form?.type === 'contact' && <ContactForm record={form.record} onClose={() => setForm(null)} onSaved={finishSave} />}
    {form?.type === 'opportunity' && <OpportunityForm record={form.record?.id ? form.record : form.record ? { ...form.record } : null} contacts={contacts} onClose={() => setForm(null)} onSaved={finishSave} />}
    {form?.type === 'task' && <TaskForm record={form.record} contacts={contacts} onClose={() => setForm(null)} onSaved={finishSave} />}
    {form?.type === 'appointment' && <AppointmentForm record={form.record} contacts={contacts} onClose={() => setForm(null)} onSaved={finishSave} />}
    {aboutOpen && <WorkspaceInfo onClose={() => setAboutOpen(false)} sampleDataSeeded={metadata?.sampleDataSeeded} protectedMode={Boolean(owner)} />}
    {toast && <div className={`toast toast-${toast.type}`} role={toast.type === 'error' ? 'alert' : 'status'} key={toast.key}>{toast.type === 'error' ? <XCircle size={19} /> : <CheckCircle2 size={19} />}<span>{toast.message}</span><IconButton label="Dismiss notification" onClick={() => setToast(null)}><X size={15} /></IconButton></div>}
  </div>;
}


export default function App() {
  return <AuthGate>{({ owner, onLogout }) => <Workspace owner={owner} onLogout={onLogout} />}</AuthGate>;
}
