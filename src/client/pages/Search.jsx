import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { api, isDemo, plainDate, shortDate } from '../api.js';
import { Button, EmptyState, ErrorState, FormField, Select, Tag } from '../components/UI.jsx';
import { PIPELINE_STAGES } from '../../shared.js';

const TYPES = [
  ['', 'All records'],
  ['contact', 'Contacts'],
  ['note', 'Notes'],
  ['deal', 'Deals'],
  ['task', 'Tasks'],
  ['appointment', 'Appointments'],
];

const typeLabel = {
  contact: 'Contact',
  note: 'Note',
  deal: 'Deal',
  task: 'Task',
  appointment: 'Appointment',
};

export function searchBanner(demo, response, status) {
  if (demo) {
    return {
      mode: 'keyword',
      title: 'Keyword search',
      label: 'Keyword search in this browser. The demo does not call Qdrant or Gemini, and these matches are not model results.',
    };
  }
  const mode = response?.mode || status?.mode || 'keyword';
  const label = response?.label || status?.label || 'Keyword search. These matches are text in this workspace, not semantic or vector results.';
  return { mode, title: mode === 'hybrid' ? 'Hybrid search' : 'Keyword search', label };
}

export function SearchView({
  demo = false,
  status = null,
  response = null,
  loading = false,
  error = null,
  query,
  filters,
  contacts = [],
  deals = [],
  onQuery,
  onFilter,
  onSubmit,
  onOpen,
  onReindex,
  reindexing = false,
}) {
  const banner = searchBanner(demo, response, status);
  const results = response?.results || [];
  return <div className="page">
    <div className="page-heading"><div><span className="eyebrow">Find a person, note, or deal</span><h1>Search</h1><p>Look across contacts, notes, deals, tasks, and appointments. Filters stay on the record you choose.</p></div></div>
    <div className={`local-banner search-banner search-banner-${banner.mode}`} role="status"><Search size={18} /><div><strong>{banner.title}</strong><span>{banner.label}</span></div><span className="sample-badge">{banner.mode === 'hybrid' ? 'HYBRID' : 'KEYWORD'}</span></div>
    <form className="search-panel panel" onSubmit={onSubmit}>
      <FormField label="Search"><input type="search" value={query} onChange={(event) => onQuery(event.target.value)} placeholder="A name, a note, or a deal" maxLength={300} required /></FormField>
      <div className="search-filters">
        <FormField label="Type" optional><Select aria-label="Record type" value={filters.type} onChange={(event) => onFilter('type', event.target.value)}>{TYPES.map(([value, label]) => <option key={value || 'all'} value={value}>{label}</option>)}</Select></FormField>
        <FormField label="Contact" optional><Select aria-label="Limit to a contact" value={filters.contactId} onChange={(event) => onFilter('contactId', event.target.value)}><option value="">Any contact</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}</Select></FormField>
        <FormField label="Deal" optional><Select aria-label="Limit to a deal" value={filters.dealId} onChange={(event) => onFilter('dealId', event.target.value)}><option value="">Any deal</option>{deals.map((deal) => <option key={deal.id} value={deal.id}>{deal.title}</option>)}</Select></FormField>
        <FormField label="Stage" optional><Select aria-label="Deal stage" value={filters.stage} onChange={(event) => onFilter('stage', event.target.value)}><option value="">Any stage</option>{PIPELINE_STAGES.map((stage) => <option key={stage}>{stage}</option>)}</Select></FormField>
        <FormField label="From" optional><input type="date" aria-label="From date" value={filters.from} onChange={(event) => onFilter('from', event.target.value)} /></FormField>
        <FormField label="To" optional><input type="date" aria-label="To date" value={filters.to} onChange={(event) => onFilter('to', event.target.value)} /></FormField>
      </div>
      <div className="search-actions"><Button variant="primary" type="submit" loading={loading}>Search</Button>{!demo && status?.mode === 'hybrid' && <Button type="button" onClick={onReindex} loading={reindexing}>Index records already saved</Button>}</div>
      {!demo && status?.mode === 'hybrid' && <p className="field-hint">Indexing sends up to 20 existing records at a time to Gemini and Qdrant. New and edited records are indexed when you save them. The demo never does this.</p>}
    </form>
    {error ? <ErrorState error={error} retry={onSubmit} /> : response && !results.length ? <EmptyState icon={Search} title="No records matched" description={banner.mode === 'hybrid' ? 'Try different words, or clear a filter that is leaving records out.' : 'Keyword search only matches words that are already written down. Try a name, company, or a word from a note.'} /> : results.length ? <section className="search-results-list panel" aria-live="polite"><h2 className="sr-only">Results</h2>{results.map((result) => <button type="button" className="search-result" key={`${result.recordType}-${result.recordId}`} onClick={() => onOpen(result)}><span className="search-result-top"><Tag>{typeLabel[result.recordType] || result.recordType}</Tag>{result.stage && <Tag tone="neutral">{result.stage}</Tag>}<time>{result.date ? (/^\d{4}-\d{2}-\d{2}$/.test(result.date) ? plainDate(result.date) : shortDate(result.date, { month: 'short', day: 'numeric', year: 'numeric' })) : ''}</time></span><strong>{result.title}</strong><p>{result.snippet}</p></button>)}</section> : null}
  </div>;
}

const emptyFilters = { type: '', contactId: '', dealId: '', stage: '', from: '', to: '' };

export default function SearchPage({ contacts = [], initialQuery = '', seed = 0, notify, openRecord }) {
  const demo = isDemo();
  const [status, setStatus] = useState(null);
  const [query, setQuery] = useState(initialQuery || '');
  const [filters, setFilters] = useState(emptyFilters);
  const [response, setResponse] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [deals, setDeals] = useState([]);
  const [reindexing, setReindexing] = useState(false);
  useEffect(() => { api('/search/status').then(setStatus).catch(() => setStatus({ mode: 'keyword', label: 'Keyword search. These matches are text in this workspace, not semantic or vector results.' })); }, []);
  useEffect(() => { api('/opportunities').then((payload) => setDeals(Object.values(payload.stages || {}).flat())).catch(() => setDeals([])); }, []);
  const run = async (event, nextQuery = query, nextFilters = filters) => {
    event?.preventDefault?.();
    if (!String(nextQuery || '').trim()) return;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ q: nextQuery.trim() });
    for (const [key, value] of Object.entries(nextFilters)) if (value) params.set(key, value);
    try { setResponse(await api(`/search?${params.toString()}`)); }
    catch (err) { setError(err); setResponse(null); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    if (!seed || !initialQuery) return;
    setQuery(initialQuery);
    setFilters(emptyFilters);
    run(null, initialQuery, emptyFilters);
  }, [seed]);
  const reindex = async () => {
    setReindexing(true);
    try {
      let offset = 0;
      let indexed = 0;
      let total = 0;
      for (let batch = 0; batch < 4; batch += 1) {
        const body = await api('/search/reindex', { method: 'POST', body: JSON.stringify({ offset }) });
        indexed += body.count || 0;
        total = body.total || total;
        if (body.nextOffset == null) {
          notify(body.mode === 'hybrid' ? `Indexed ${indexed} of ${total} records.` : body.label);
          return;
        }
        offset = body.nextOffset;
      }
      notify(`Indexed ${indexed} records. Run this again later to continue. Four batches can run each hour.`);
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setReindexing(false);
    }
  };
  return <SearchView demo={demo} status={status} response={response} loading={loading} error={error} query={query} filters={filters} contacts={contacts} deals={deals} onQuery={setQuery} onFilter={(key, value) => setFilters((current) => ({ ...current, [key]: value }))} onSubmit={run} onOpen={openRecord} onReindex={reindex} reindexing={reindexing} />;
}
