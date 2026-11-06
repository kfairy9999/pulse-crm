import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BriefcaseBusiness, Building2, CalendarDays, CheckSquare, Clock3, Edit3, Mail, MapPin, MessageSquareText, MoreHorizontal, Phone, Plus, Send, Trash2, UserPlus, UsersRound } from 'lucide-react';
import { api, money, plainDate, relativeTime, shortDate, toDateTimeLocal } from '../api.js';
import { useResource } from '../hooks.js';
import { Avatar, Button, ConfirmDialog, EmptyState, ErrorState, FormField, IconButton, LoadingState, Modal, SearchInput, Tag } from '../components/UI.jsx';
import { PIPELINE_STAGES } from '../../shared.js';

function ContactDetails({ contactId, onClose, onEdit, onDelete, notify, onChanged }) {
  const { data, loading, error, reload } = useResource(`/contacts/${contactId}`);
  const [tab, setTab] = useState('overview');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const saveNote = async (event) => {
    event.preventDefault();
    if (!note.trim()) return;
    setSaving(true);
    try { await api(`/contacts/${contactId}/notes`, { method: 'POST', body: JSON.stringify({ body: note }) }); setNote(''); await reload(true); onChanged(); notify('Note saved to this contact.'); }
    catch (err) { notify(err.message, 'error'); }
    finally { setSaving(false); }
  };
  return <Modal title={data?.contact?.name || 'Contact details'} eyebrow="Contact profile" onClose={onClose} wide>
    {loading ? <LoadingState label="Opening contact" /> : error ? <ErrorState error={error} retry={reload} /> : <>
      <div className="contact-identity"><Avatar name={data.contact.name} size="large" /><div><h3>{data.contact.name}</h3><p>{data.contact.job_title || 'Contact'}{data.contact.company ? ` at ${data.contact.company}` : ''}</p><div className="contact-tags">{data.contact.tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}</div></div><div className="contact-identity-actions"><Button icon={Edit3} onClick={() => onEdit(data.contact)}>Edit</Button><IconButton label={`Delete ${data.contact.name}`} className="danger-icon" onClick={() => setConfirming(true)}><Trash2 size={17} /></IconButton></div></div>
      <div className="contact-quick-info">{data.contact.email && <a href={`mailto:${data.contact.email}`} title="Open your email app"><Mail size={15} /><span>{data.contact.email}</span></a>}{data.contact.phone && <a href={`tel:${data.contact.phone}`}><Phone size={15} /><span>{data.contact.phone}</span></a>}{!data.contact.email && !data.contact.phone && <span><UsersRound size={15} />No email or phone added</span>}</div>
      <div className="contact-detail-stats"><div><strong>{data.opportunities.length}</strong><span>{data.opportunities.length === 1 ? 'Opportunity' : 'Opportunities'}</span></div><div><strong>{money(data.opportunities.filter((item) => !['Won', 'Lost'].includes(item.stage)).reduce((sum, item) => sum + item.value, 0), true)}</strong><span>Open value</span></div><div><strong>{data.notes.length}</strong><span>Notes</span></div><div><strong>{data.tasks.filter((item) => item.status === 'Open').length}</strong><span>Open tasks</span></div></div>
      <div className="tab-list" role="tablist">{['overview', 'notes', 'activity'].map((name) => <button role="tab" aria-selected={tab === name} key={name} onClick={() => setTab(name)}>{name === 'overview' ? 'Opportunities' : name === 'notes' ? `Notes (${data.notes.length})` : 'Tasks & schedule'}</button>)}</div>
      {tab === 'overview' && <div className="contact-deals">{data.opportunities.length ? data.opportunities.map((deal) => <div className="contact-deal" key={deal.id}><span className="deal-symbol"><BriefcaseBusiness size={17} /></span><div><strong>{deal.title}</strong><span>{deal.stage}{deal.expected_close_date && ` · Close ${plainDate(deal.expected_close_date)}`}</span></div><strong>{money(deal.value)}</strong></div>) : <EmptyState icon={BriefcaseBusiness} title="No opportunities yet" description="Create a deal to start tracking this relationship." />}</div>}
      {tab === 'notes' && <div className="notes-area"><form className="note-form" onSubmit={saveNote}><FormField label="Add a local note"><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add context, next steps, or a useful detail…" rows="3" maxLength={5000} required /></FormField><div className="note-form-bottom"><span>Stored on this computer · never sent</span><Button variant="primary" type="submit" loading={saving} disabled={!note.trim()}>Save note</Button></div></form><div className="notes-list">{data.notes.map((item) => <article className="contact-note" key={item.id}><Avatar name={data.contact.name} size="small" /><div><div className="note-byline"><strong>{item.author === 'Sample note' ? 'Sample note' : 'You'}</strong><span>{item.author === 'Sample note' && <Tag tone="demo">Sample</Tag>} {shortDate(item.created_at, { month: 'short', day: 'numeric', year: 'numeric' })}</span></div><p>{item.body}</p><span className="local-caption">Local note · not a received message</span></div></article>)}{!data.notes.length && <p className="muted">No notes yet. Add the first one above.</p>}</div></div>}
      {tab === 'activity' && <div className="contact-related"><section><h3>Open & completed tasks</h3>{data.tasks.length ? data.tasks.map((task) => <div className="related-row" key={task.id}><CheckSquare size={16} /><span>{task.title}</span><Tag tone={task.status === 'Completed' ? 'green' : 'neutral'}>{task.status === 'Completed' ? 'Completed' : task.due_date ? plainDate(task.due_date) : 'Open'}</Tag></div>) : <p className="muted">No tasks linked to this contact.</p>}</section><section><h3>Local appointments</h3>{data.appointments.length ? data.appointments.map((appointment) => <div className="related-row" key={appointment.id}><CalendarDays size={16} /><span>{appointment.title}</span><span className="muted">{shortDate(appointment.starts_at, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span></div>) : <p className="muted">No appointments linked to this contact.</p>}</section></div>}
      <div className="contact-last-updated">Added {shortDate(data.contact.created_at, { year: 'numeric' })} · Last updated {relativeTime(data.contact.updated_at)}</div>
    </>}
    {confirming && <ConfirmDialog title={`Delete ${data.contact.name}?`} description="This permanently removes their contact record, notes, and linked tasks/appointments. Contacts with opportunities must have those deals deleted or reassigned first." onClose={() => setConfirming(false)} onConfirm={async () => { setSaving(true); try { await api(`/contacts/${contactId}`, { method: 'DELETE' }); setConfirming(false); onDelete(); } catch (err) { notify(err.message, 'error'); setConfirming(false); } finally { setSaving(false); } }} busy={saving} />}
  </Modal>;
}

export default function Contacts({ search, setSearch, openForm, notify, revision }) {
  const [query, setQuery] = useState(search || '');
  const [debounced, setDebounced] = useState('');
  const [tag, setTag] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [page, setPage] = useState(1);
  useEffect(() => { setQuery(search || ''); }, [search]);
  useEffect(() => { const timer = setTimeout(() => { setDebounced(query); setPage(1); }, 230); return () => clearTimeout(timer); }, [query]);
  useEffect(() => { setSearch?.(''); }, []);
  const path = `/contacts?q=${encodeURIComponent(debounced)}&tag=${encodeURIComponent(tag)}`;
  const { data, loading, error, reload } = useResource(path);
  const refresh = async () => { await reload(true); };
  const pageSize = 10;
  const contacts = data?.contacts || [];
  const pages = Math.max(1, Math.ceil(contacts.length / pageSize));
  const shown = contacts.slice((Math.min(page, pages) - 1) * pageSize, Math.min(page, pages) * pageSize);
  return <div className="page">
    <div className="page-heading"><div><span className="eyebrow">Your network, in one place</span><h1>Contacts<span className="count-badge">{data?.total ?? '—'}</span></h1><p>Build stronger relationships with the right context.</p></div><Button variant="primary" icon={UserPlus} onClick={() => openForm('contact', refresh)}>Add contact</Button></div>
    <div className="toolbar"><SearchInput placeholder="Search people or companies" value={query} onChange={(event) => setQuery(event.target.value)} /><div className="filter-chips"><button className={!tag ? 'filter-chip active' : 'filter-chip'} onClick={() => { setTag(''); setPage(1); }}>All contacts</button>{data?.tags?.map((item) => <button key={item} className={tag === item ? 'filter-chip active' : 'filter-chip'} onClick={() => { setTag(tag === item ? '' : item); setPage(1); }}>#{item}</button>)}</div></div>
    {loading && !data ? <LoadingState label="Loading your network" /> : error ? <ErrorState error={error} retry={reload} /> : <section className="contacts-panel panel">
      {shown.length ? <div className="contacts-table-wrap"><table className="contacts-table"><thead><tr><th>Contact</th><th>Company</th><th>Tags</th><th>Pipeline</th><th>Last updated</th><th><span className="sr-only">Contact actions</span></th></tr></thead><tbody>{shown.map((contact) => <tr key={contact.id}><td><button className="contact-cell" onClick={() => setSelectedId(contact.id)}><Avatar name={contact.name} /><span><strong>{contact.name}</strong><small>{contact.email || contact.phone || 'No contact details yet'}</small></span></button></td><td><span className="company-cell">{contact.company ? <><Building2 size={14} />{contact.company}</> : '—'}</span></td><td><div className="table-tags">{contact.tags.slice(0, 2).map((item) => <Tag key={item}>{item}</Tag>)}{contact.tags.length > 2 && <span className="muted">+{contact.tags.length - 2}</span>}{!contact.tags.length && '—'}</div></td><td>{contact.opportunity_count ? <span className="opportunity-count"><BriefcaseBusiness size={14} />{contact.opportunity_count} <span className="opportunity-label">{contact.opportunity_count === 1 ? 'deal' : 'deals'}</span></span> : <span className="muted">No deals</span>}</td><td><span className="muted date-cell">{relativeTime(contact.updated_at)}</span></td><td><IconButton label={`Open ${contact.name}`} onClick={() => setSelectedId(contact.id)}><ArrowRight size={16} /></IconButton></td></tr>)}</tbody></table></div> : <EmptyState icon={UsersRound} title={debounced || tag ? 'No matching contacts' : 'Your network starts here'} description={debounced || tag ? 'Try another name or tag, or clear the filters.' : 'Add your first contact to begin tracking conversations and opportunities.'} action={<Button variant="primary" icon={Plus} onClick={() => openForm('contact', refresh)}>Add contact</Button>} />}
      <div className="table-footer"><span>{data.total} {data.total === 1 ? 'contact' : 'contacts'}{debounced || tag ? ' matching your filters' : ''}</span><div className="pagination"><button aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)}><ArrowLeft size={15} /></button><span>Page {Math.min(page, pages)} of {pages}</span><button aria-label="Next page" disabled={page >= pages} onClick={() => setPage(page + 1)}><ArrowRight size={15} /></button></div></div>
    </section>}
    {selectedId && <ContactDetails key={selectedId} contactId={selectedId} onClose={() => setSelectedId(null)} onEdit={(contact) => { setSelectedId(null); openForm('contact', async () => { await refresh(); setSelectedId(contact.id); }, contact); }} onDelete={async () => { setSelectedId(null); await refresh(); notify('Contact deleted.'); }} onChanged={refresh} notify={notify} />}
  </div>;
}
