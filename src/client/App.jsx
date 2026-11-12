import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowRight, Bell, BriefcaseBusiness, CalendarDays, Check, CheckCircle2, CheckSquare, ChevronDown, CircleHelp, ContactRound, Inbox, LayoutDashboard, LoaderCircle, LogOut, Menu, PanelLeftClose, PieChart, Plus, Search, Settings2, ShieldCheck, Sparkles, UsersRound, WifiOff, X, XCircle } from 'lucide-react';
import Dashboard from './pages/Dashboard.jsx';
import Contacts from './pages/Contacts.jsx';
import Pipeline from './pages/Pipeline.jsx';
import Tasks from './pages/Tasks.jsx';
import Calendar from './pages/Calendar.jsx';
import InboxPage from './pages/Inbox.jsx';
import Reports from './pages/Reports.jsx';
import SearchPage from './pages/Search.jsx';
import { AppointmentForm, ContactForm, OpportunityForm, TaskForm } from './components/Forms.jsx';
import { Avatar, Button, ErrorState, IconButton, Modal, SearchInput } from './components/UI.jsx';
import { api, isDemo } from './api.js';
import AuthGate from './AuthGate.jsx';

const navigation = [
  { id: 'dashboard', label: 'Overview', icon: LayoutDashboard, group: 'Workspace' },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'contacts', label: 'Contacts', icon: ContactRound },
  { id: 'pipeline', label: 'Pipeline', icon: BriefcaseBusiness },
  { id: 'tasks', label: 'Tasks', icon: CheckSquare },
  { id: 'calendar', label: 'Schedule', icon: CalendarDays },
  { id: 'reports', label: 'Reports', icon: PieChart },
  { id: 'inbox', label: 'Inbox', icon: Inbox, badge: 'Local' },
  { id: 'workflows', label: 'Workflows', icon: Activity, group: 'Automation' },
];
const pageTitles = { dashboard: 'Overview', search: 'Search', contacts: 'Contacts', pipeline: 'Pipeline', tasks: 'Tasks', calendar: 'Schedule', reports: 'Reports', inbox: 'Inbox · Local notes', workflows: 'Workflows' };

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

function GlobalSearch({ contacts, navigate, searchContacts, openSearch }) {
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
    <Search size={17} /><input aria-label="Search the workspace" aria-keyshortcuts="Control+K Meta+K" value={query} placeholder="Search notes, deals, people" onFocus={() => setFocused(true)} onChange={(event) => { const value = event.target.value; setQuery(value); setFocused(true); }} onKeyDown={(event) => { if (event.key === 'Enter' && query.trim()) { openSearch(query); setQuery(''); setFocused(false); } if (event.key === 'Escape') { setFocused(false); setQuery(''); } }} /><kbd>{typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘K' : 'Ctrl K'}</kbd>
    {focused && query.trim() && <div className="search-results"><button onClick={() => { openSearch(query); setQuery(''); setFocused(false); }}><span><Search size={16} /></span><div><strong>Search all records</strong><small>Notes, deals, tasks, and people</small></div><ArrowRight size={14} /></button>{results.map((result) => <button key={`${result.type}-${result.id}`} onClick={() => { if (result.type === 'page') navigate(result.id); else searchContacts(result.title); setQuery(''); setFocused(false); }}><span><result.icon size={16} /></span><div><strong>{result.title}</strong><small>{result.caption}</small></div><ArrowRight size={14} /></button>)}</div>}
  </div>;
}

function QuickAdd({ page, openForm }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const actions = [
    { type: 'contact', label: 'Contact', detail: 'Someone you want to remember' },
    { type: 'opportunity', label: 'Opportunity', detail: 'A deal linked to a person' },
    { type: 'task', label: 'Task', detail: 'A follow-up you can check off' },
    { type: 'appointment', label: 'Appointment', detail: 'Time on your local schedule' },
  ];
  const suggested = page === 'calendar' ? 'appointment' : page === 'tasks' ? 'task' : page === 'contacts' ? 'contact' : 'opportunity';
  const current = actions.find((item) => item.type === suggested);
  useEffect(() => { setOpen(false); }, [page]);
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onPointer); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return <div className="quick-add" ref={rootRef}>
    <Button variant="primary" className="quick-add-button" icon={Plus} onClick={() => openForm(suggested)}><span className="quick-add-label">Add {current.label.toLowerCase()}</span><span className="quick-add-short">Add</span></Button>
    <IconButton className="quick-add-more" label="More things to add" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((value) => !value)}><ChevronDown size={16} /></IconButton>
    {open && <div className="quick-add-menu" role="menu">{actions.map((action) => <button type="button" role="menuitem" key={action.type} className={action.type === suggested ? 'is-suggested' : ''} onClick={() => { setOpen(false); openForm(action.type); }}><strong>{action.label}</strong><small>{action.detail}</small></button>)}</div>}
  </div>;
}

function WorkspaceInfo({ onClose, sampleDataSeeded, protectedMode }) {
  return <Modal title="A focused CRM, built for momentum" eyebrow="About this workspace" onClose={onClose}><div className="workspace-info"><div className="info-symbol"><ShieldCheck size={27} /></div><h3>{protectedMode ? 'Private, and ready when you are.' : 'Yours alone, on this machine.'}</h3><p>Contacts, deals, tasks, notes, and appointments stay in your workspace database. Nothing here is emailed or synced. Search matches words in this database unless the server has Qdrant and a Gemini embedding key. The public demo always stays on keyword search in the browser.</p><div className="info-list"><div><Check size={16} /><span>{protectedMode ? 'Owner authentication and secure HTTPS sessions' : 'Cloudflare D1 · no external integrations'}</span></div><div><Check size={16} /><span>No external account sync or application-managed backup</span></div><div><Check size={16} /><span>No email, messaging, or calendar integrations</span></div><div><Check size={16} /><span>No automated workflows or background sending</span></div></div>{sampleDataSeeded && <div className="callout"><Sparkles size={16} /><p>Sample people and companies are fictional workspace data. They are not imported from your personal accounts.</p></div>}<p className="small-print">Back up the D1 database regularly. Provider storage needs a separate, verified recovery plan; it cannot prevent every possible loss.</p></div></Modal>;
}

export function Workflows({ navigate }) {
  return <div className="page"><div className="page-heading"><div><span className="eyebrow">Automation, when it’s real</span><h1>Workflows<span className="count-badge">Not connected</span></h1><p>No pretend automations. The tools below are the ones that really work today.</p></div><Button variant="primary" icon={Plus} onClick={() => navigate('tasks')}>Create a follow-up</Button></div><div className="workflow-empty panel"><span className="workflow-empty-art"><Activity size={33} /><span>↗</span></span><span className="eyebrow">A deliberate boundary</span><h2>Automations aren’t connected yet</h2><p>Pulse doesn’t send emails, text messages, schedule background jobs, or trigger external actions. Until those integrations are genuine, this workspace stays intentionally quiet.</p><div className="workflow-alternatives"><div><CheckSquare size={20} /><h3>Keep a next step</h3><p>Write the next thing you’ll do for someone, with a date you can see.</p><Button onClick={() => navigate('tasks')}>Go to tasks <ArrowRight size={15} /></Button></div><div><CalendarDays size={20} /><h3>Make time to connect</h3><p>Record an appointment on your local schedule.</p><Button onClick={() => navigate('calendar')}>Open schedule <ArrowRight size={15} /></Button></div><div><Inbox size={20} /><h3>Remember the context</h3><p>Add a local note to the contact it belongs to.</p><Button onClick={() => navigate('contacts')}>Find a contact <ArrowRight size={15} /></Button></div></div></div></div>;
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
  const [searchSeed, setSearchSeed] = useState({ text: '', nonce: 0 });
  const [searchMode, setSearchMode] = useState('keyword');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef(null);
  const notify = useCallback((message, type = 'success') => setToast({ message, type, key: Date.now() }), []);
  const refreshContacts = useCallback(async () => { try { setContacts((await api('/contacts')).contacts); } catch { /* Individual views show API errors. */ } }, []);
  useEffect(() => { api('/metadata').then(setMetadata).catch((error) => notify(error.message, 'error')); }, [notify]);
  useEffect(() => { api('/search/status').then((status) => setSearchMode(status.mode === 'hybrid' ? 'hybrid' : 'keyword')).catch(() => setSearchMode('keyword')); }, []);
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
  useEffect(() => { document.title = `${pageTitles[page]} · Pulse CRM`; }, [page]);
  const openForm = useCallback((type, afterSave, record = null) => setForm({ type, afterSave, record }), []);
  const finishSave = async (isDelete = false) => { setForm(null); setRevision((value) => value + 1); await refreshContacts(); await form?.afterSave?.(); if (!isDelete) notify({ contact: form.record?.id ? 'Contact updated.' : 'Contact saved. They’re in your book.', opportunity: form.record?.id ? 'Opportunity updated.' : 'Opportunity added to your pipeline.', task: form.record?.id ? 'Task updated.' : 'Task added. You have a next step.', appointment: form.record?.id ? 'Appointment updated.' : 'Appointment saved on your schedule.' }[form.type]); };
  const searchContacts = (query) => { setContactSearch(query); navigate('contacts'); };
  const openSearch = (query) => { setSearchSeed({ text: query, nonce: Date.now() }); navigate('search'); };
  const openRecord = (result) => {
    const contact = contacts.find((item) => item.id === result.contactId);
    if (result.recordType === 'deal') { navigate('pipeline'); return; }
    if (contact) { setContactSearch(contact.name); navigate('contacts'); return; }
    navigate(result.recordType === 'task' ? 'tasks' : result.recordType === 'appointment' ? 'calendar' : 'search');
  };
  const toggleTask = async (task) => { try { await api(`/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ completed: task.status !== 'Completed' }) }); setRevision((value) => value + 1); notify(task.status === 'Completed' ? 'Task reopened.' : 'Task complete — nice work.'); } catch (error) { notify(error.message, 'error'); } };
  const common = { openForm, notify, navigate, contacts };
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    {mobileNav && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <aside className={`sidebar ${mobileNav ? 'sidebar-mobile-open' : ''}`}><div className="brand"><span className="brand-symbol"><svg width="31" height="29" viewBox="0 0 36 30" fill="none"><path d="M2 16h7l4-10 8 21 5-14h8" stroke="currentColor" strokeWidth="3.3" strokeLinecap="round" strokeLinejoin="round" /></svg></span><span className="brand-name">pulse<span>.</span></span><span className="brand-crm">CRM</span><IconButton className="mobile-nav-close" label="Close navigation" onClick={() => setMobileNav(false)}><X size={19} /></IconButton></div><div className="workspace-switch"><Avatar name="Kevin Fairley" size="small" /><div><strong>Kevin’s workspace</strong><span>Personal · {owner ? 'Protected' : 'Local'}</span></div></div><nav className="main-navigation" aria-label="Main navigation">{navigation.map((item, index) => <div key={item.id}>{item.group && <span className="nav-group-title">{item.group}</span>}<button className={`nav-item ${page === item.id ? 'active' : ''}`} aria-current={page === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><item.icon size={19} strokeWidth={page === item.id ? 2.1 : 1.65} /><span>{item.label}</span>{item.badge && <span className="nav-badge">{item.badge}</span>}{item.id === 'workflows' && <span className="nav-soon">—</span>}</button></div>)}</nav><div className="sidebar-bottom"><div className="local-status"><span className="local-status-icon"><ShieldCheck size={16} /></span><div><strong>{owner ? 'Private, protected workspace' : 'Local workspace'}</strong><span>{owner ? 'Owner-only sign in' : 'Persisted on your database'}</span></div></div><button className="nav-item" onClick={() => setAboutOpen(true)}><CircleHelp size={18} /><span>Workspace info</span></button><div className="profile"><Avatar name="Kevin Fairley" size="small" /><div><strong>Kevin Fairley</strong><span>Workspace owner</span></div><span className="online-dot" title="Workspace online" /></div></div></aside>
    <div className="main-shell">{isDemo() && <div className="demo-banner" role="note"><Sparkles size={16} aria-hidden="true" /><span><strong>Demo workspace.</strong> Sample people and deals, running in your browser. Changes vanish when you reload.</span><a href="https://github.com/kfairy9999/pulse-crm">Source</a></div>}<header className="app-topbar"><div className="topbar-page"><IconButton className="mobile-menu-button" label="Open navigation" onClick={() => setMobileNav(true)}><Menu size={20} /></IconButton><span>{pageTitles[page]}</span><span className="topbar-breadcrumb">{isDemo() ? '/ Demo workspace' : '/ Kevin’s workspace'}</span></div><>{owner && <Button className="sign-out-button" onClick={onLogout} icon={LogOut}>Sign out</Button>}</><div ref={searchRef} className={`desktop-global-search ${searchOpen ? 'force-visible' : ''}`}><GlobalSearch contacts={contacts} navigate={navigate} searchContacts={searchContacts} openSearch={openSearch} /></div><div className="topbar-right"><span className="local-topbar-label"><span />{owner ? 'PRIVATE' : 'LOCAL'}</span><IconButton className="mobile-search-button" label="Search contacts" onClick={() => setSearchOpen((value) => !value)}><Search size={19} /></IconButton><QuickAdd page={page} openForm={openForm} /></div></header><main id="main-content" tabIndex={-1} className={page === 'pipeline' ? 'pipeline-main' : ''}><PageBoundary key={page}>{page === 'dashboard' ? <Dashboard key={revision} {...common} sampleDataSeeded={metadata?.sampleDataSeeded} toggleTask={toggleTask} /> : page === 'search' ? <SearchPage contacts={contacts} initialQuery={searchSeed.text} seed={searchSeed.nonce} notify={notify} openRecord={openRecord} /> : page === 'contacts' ? <Contacts key={revision} {...common} search={contactSearch} setSearch={setContactSearch} /> : page === 'pipeline' ? <Pipeline key={revision} {...common} /> : page === 'tasks' ? <Tasks key={revision} {...common} /> : page === 'calendar' ? <Calendar key={revision} {...common} /> : page === 'reports' ? <Reports key={revision} {...common} /> : page === 'inbox' ? <InboxPage key={revision} {...common} /> : <Workflows navigate={navigate} />}</PageBoundary></main><footer className="app-footer"><span>Pulse CRM <span className="middot">·</span> Made for the next conversation.</span><span><span className="footer-dot" />{isDemo() ? 'Saved in this browser · Nothing is sent' : searchMode === 'hybrid' ? 'Saved in your database · Hybrid search uses Qdrant and Gemini' : 'Saved in your database · Keyword search stays here'}</span></footer></div>
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
