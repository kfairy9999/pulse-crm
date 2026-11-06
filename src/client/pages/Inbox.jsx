import { useMemo, useState } from 'react';
import { ArrowRight, BookOpenText, CheckSquare, Clock3, Edit3, Info, Mail, MessageSquareText, Plus, Search, ShieldCheck, Unplug, UsersRound } from 'lucide-react';
import { api, relativeTime, shortDate } from '../api.js';
import { useResource } from '../hooks.js';
import { Avatar, Button, EmptyState, ErrorState, FormField, LoadingState, SearchInput, Tag } from '../components/UI.jsx';

export default function Inbox({ openForm, notify, revision }) {
  const { data, loading, error, reload } = useResource('/inbox');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const notes = (data?.notes || []).filter((item) => `${item.contact_name} ${item.company || ''} ${item.body}`.toLowerCase().includes(query.toLowerCase()));
  const selected = notes.find((item) => item.id === selectedId) || notes[0];
  const saveNote = async (event) => {
    event.preventDefault();
    if (!selected || !note.trim()) return;
    setBusy(true);
    try { await api(`/contacts/${selected.contact_id}/notes`, { method: 'POST', body: JSON.stringify({ body: note }) }); setNote(''); await reload(true); notify('Note saved locally. Nothing was sent.'); }
    catch (err) { notify(err.message, 'error'); }
    finally { setBusy(false); }
  };
  return <div className="page">
    <div className="page-heading"><div><span className="eyebrow">Context, close at hand</span><h1>Inbox<span className="count-badge">Local notes</span></h1><p>Keep useful details beside the relationships they belong to.</p></div><Button variant="primary" icon={Plus} onClick={() => openForm('contact', () => reload(true))}>Add a contact</Button></div>
    <div className="local-banner inbox-banner"><Unplug size={18} /><div><strong>Not connected to email or messaging</strong><span>This is a local contact-notes view, not a message inbox. Notes are stored on this computer; nothing is sent, received, or imported.</span></div><span className="sample-badge">NOTES ONLY</span></div>
    {loading ? <LoadingState label="Opening local notes" /> : error ? <ErrorState error={error} retry={reload} /> : <div className="notes-inbox panel"><aside className="inbox-list"><div className="inbox-list-header"><h2>Contact notes <span>{notes.length}</span></h2><SearchInput placeholder="Search local notes" value={query} onChange={(event) => setQuery(event.target.value)} /></div><div>{notes.map((item) => <button className={`inbox-note-row ${selected?.id === item.id ? 'selected' : ''}`} key={item.id} onClick={() => setSelectedId(item.id)}><Avatar name={item.contact_name} size="small" /><div><div><strong>{item.contact_name}</strong><time>{relativeTime(item.created_at)}</time></div><span className="inbox-note-label">{item.author === 'Sample note' ? 'SAMPLE NOTE' : 'YOUR NOTE'}</span><p>{item.body}</p></div></button>)}{!notes.length && <EmptyState icon={BookOpenText} title="No local notes" description="Select a contact and add the first note from the Contacts workspace." />}</div></aside><section className="note-reader">{selected ? <><header className="note-reader-header"><div className="note-reader-person"><Avatar name={selected.contact_name} /><div><h2>{selected.contact_name}</h2><p>{selected.company || 'Local contact'}{selected.email && ` · ${selected.email}`}</p></div></div><Tag tone={selected.author === 'Sample note' ? 'demo' : 'green'}>{selected.author === 'Sample note' ? 'Sample note' : 'Local note'}</Tag></header><div className="note-reader-body"><div className="note-context"><BookOpenText size={18} /><span>Saved {shortDate(selected.created_at, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</span></div><blockquote>{selected.body}</blockquote><p className="reader-disclaimer"><ShieldCheck size={15} />Stored in Pulse’s local database. This was not received from the contact.</p></div><form className="inbox-composer" onSubmit={saveNote}><FormField label={`Add a note about ${selected.contact_name}`}><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Capture context or a follow-up…" rows="4" maxLength={5000} required /></FormField><div><span><Info size={14} />Saves a note — this does not send a message.</span><Button variant="primary" type="submit" loading={busy} disabled={!note.trim()} icon={Edit3}>Save local note</Button></div></form></> : <EmptyState icon={MessageSquareText} title="Your notes have a home" description="Select a note to read it here, or add one to a contact." />}</section></div>}
  </div>;
}
