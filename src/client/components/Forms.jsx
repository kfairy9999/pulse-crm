import { useState } from 'react';
import { AlertCircle, ArrowRight, CalendarDays, CheckSquare, DollarSign, UsersRound } from 'lucide-react';
import { api, toDateTimeLocal } from '../api.js';
import { Button, FormField, Modal, Select } from './UI.jsx';
import { PIPELINE_STAGES, TASK_PRIORITIES } from '../../shared.js';

async function submitForm({ event, record, endpoint, setBusy, setError, onSaved }) {
  event.preventDefault();
  setBusy(true); setError(null);
  const values = Object.fromEntries(new FormData(event.currentTarget));
  try {
    await api(endpoint, { method: record ? 'PATCH' : 'POST', body: JSON.stringify(values) });
    onSaved();
  } catch (error) { setError(error); }
  finally { setBusy(false); }
}

function FormShell({ title, eyebrow, record, endpoint, onClose, onSaved, children, defaultValue, submitLabel, wide = false }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  return <Modal title={title} eyebrow={eyebrow} onClose={onClose} wide={wide}>
    <form onSubmit={(event) => submitForm({ event, record, endpoint, setBusy, setError, onSaved })}>
      {error && <div className="form-alert" role="alert"><AlertCircle size={17} /><span>{error.message}</span></div>}
      <div className="form-grid">{children(error)}</div>
      <div className="modal-actions"><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" type="submit" loading={busy}>{submitLabel || (record ? 'Save changes' : 'Create')}<ArrowRight size={16} /></Button></div>
    </form>
  </Modal>;
}

export function ContactForm({ record, contacts = [], onClose, onSaved }) {
  const endpoint = record?.id ? `/contacts/${record.id}` : '/contacts';
  return <FormShell title={record?.id ? 'Edit contact' : 'Add a contact'} eyebrow="Relationship management" record={record?.id ? record : null} endpoint={endpoint} onClose={onClose} onSaved={onSaved} submitLabel={record?.id ? 'Save contact' : 'Add contact'}>
    {(error) => <>
      <FormField label="First name" error={error?.fields?.first_name}><input name="first_name" defaultValue={record?.first_name || ''} required maxLength={80} placeholder="Jordan" autoFocus /></FormField>
      <FormField label="Last name" optional><input name="last_name" defaultValue={record?.last_name || ''} maxLength={80} placeholder="Lee" /></FormField>
      <FormField label="Email address" error={error?.fields?.email} optional><input name="email" type="email" defaultValue={record?.email || ''} placeholder="jordan@company.com" /></FormField>
      <FormField label="Phone number" optional><input name="phone" type="tel" defaultValue={record?.phone || ''} placeholder="+1 555 000 0000" /></FormField>
      <FormField label="Company" optional><input name="company" defaultValue={record?.company || ''} placeholder="Acme Studio" /></FormField>
      <FormField label="Job title" optional><input name="job_title" defaultValue={record?.job_title || ''} placeholder="Founder" /></FormField>
      <FormField label="Tags" optional className="field-full" hint="Separate tags with commas. Tags become searchable filters."><input name="tags" defaultValue={record?.tags?.join(', ') || ''} placeholder="qualified, referral" /></FormField>
    </>}
  </FormShell>;
}

export function ContactSelect({ contacts, defaultValue = '', required = false }) {
  return <Select name="contact_id" defaultValue={defaultValue || ''} required={required}>
    <option value="">{required ? 'Select a contact…' : 'No contact'}</option>
    {contacts.map((contact) => <option value={contact.id} key={contact.id}>{contact.name}{contact.company ? ` · ${contact.company}` : ''}</option>)}
  </Select>;
}

export function OpportunityForm({ record, contacts, onClose, onSaved }) {
  const endpoint = record?.id ? `/opportunities/${record.id}` : '/opportunities';
  if (!contacts.length) return <Modal title="A contact comes first" eyebrow="New opportunity" onClose={onClose}><p className="confirm-description">Every opportunity is linked to a contact. Add a contact before creating a deal.</p><div className="modal-actions"><Button onClick={onClose}>Cancel</Button></div></Modal>;
  return <FormShell title={record?.id ? 'Edit opportunity' : 'Create an opportunity'} eyebrow="Revenue pipeline" record={record?.id ? record : null} endpoint={endpoint} onClose={onClose} onSaved={onSaved} submitLabel={record?.id ? 'Save opportunity' : 'Create opportunity'}>
    {(error) => <>
      <FormField label="Opportunity name" className="field-full"><input name="title" defaultValue={record?.title || ''} required maxLength={180} placeholder="e.g. Brand launch retainer" autoFocus /></FormField>
      <FormField label="Contact" className="field-full"><ContactSelect contacts={contacts} defaultValue={record?.contact_id || contacts[0].id} required /></FormField>
      <FormField label="Value (USD)"><div className="input-prefix"><DollarSign size={16} /><input name="value" type="number" min="0" max="1000000000" step="0.01" defaultValue={record?.value ?? ''} placeholder="5,000" required /></div></FormField>
      <FormField label="Stage"><Select name="stage" defaultValue={record?.stage || 'New Lead'}>{PIPELINE_STAGES.map((stage) => <option key={stage}>{stage}</option>)}</Select></FormField>
      <FormField label="Expected close date" optional className="field-full"><input name="expected_close_date" type="date" defaultValue={record?.expected_close_date || ''} /></FormField>
      <FormField label="Notes" optional className="field-full"><textarea name="notes" defaultValue={record?.notes || ''} maxLength={4000} placeholder="What matters to this customer?" rows="3" /></FormField>
    </>}
  </FormShell>;
}

export function TaskForm({ record, contacts, onClose, onSaved }) {
  const endpoint = record?.id ? `/tasks/${record.id}` : '/tasks';
  return <FormShell title={record?.id ? 'Edit task' : 'Add a task'} eyebrow="Stay on top of follow-ups" record={record?.id ? record : null} endpoint={endpoint} onClose={onClose} onSaved={onSaved} submitLabel={record?.id ? 'Save task' : 'Add task'}>
    {(error) => <>
      <FormField label="What needs to happen?" className="field-full"><input name="title" defaultValue={record?.title || ''} required maxLength={180} placeholder="e.g. Send the project proposal" autoFocus /></FormField>
      <FormField label="Contact" optional className="field-full"><ContactSelect contacts={contacts} defaultValue={record?.contact_id} /></FormField>
      <FormField label="Due date" optional><input name="due_date" type="date" defaultValue={record?.due_date || ''} /></FormField>
      <FormField label="Priority"><Select name="priority" defaultValue={record?.priority || 'Medium'}>{TASK_PRIORITIES.map((priority) => <option key={priority}>{priority}</option>)}</Select></FormField>
      {record?.id && <FormField label="Status" className="field-full"><Select name="status" defaultValue={record.status}><option>Open</option><option>Completed</option></Select></FormField>}
      <FormField label="Notes" optional className="field-full"><textarea name="notes" defaultValue={record?.notes || ''} maxLength={4000} placeholder="Add useful context…" rows="3" /></FormField>
    </>}
  </FormShell>;
}

export function AppointmentForm({ record, contacts, onClose, onSaved }) {
  const endpoint = record?.id ? `/appointments/${record.id}` : '/appointments';
  return <FormShell title={record?.id ? 'Edit appointment' : 'Book an appointment'} eyebrow="Local schedule · no calendar invites sent" record={record?.id ? record : null} endpoint={endpoint} onClose={onClose} onSaved={onSaved} submitLabel={record?.id ? 'Save appointment' : 'Add to schedule'}>
    {(error) => <>
      <FormField label="Appointment title" className="field-full"><input name="title" defaultValue={record?.title || ''} required maxLength={180} placeholder="e.g. Discovery call" autoFocus /></FormField>
      <FormField label="Contact" optional className="field-full"><ContactSelect contacts={contacts} defaultValue={record?.contact_id} /></FormField>
      <FormField label="Date and time"><input name="starts_at" type="datetime-local" defaultValue={toDateTimeLocal(record?.starts_at) || ''} required /></FormField>
      <FormField label="Duration (minutes)"><input name="duration_minutes" type="number" min="1" max="1440" step="1" defaultValue={record?.duration_minutes || 30} required /></FormField>
      <FormField label="Location or meeting link" optional className="field-full" hint="A label only. Pulse does not join calls or send invitations."><input name="location" defaultValue={record?.location || ''} maxLength={240} placeholder="Studio or video call" /></FormField>
      <FormField label="Notes" optional className="field-full"><textarea name="notes" defaultValue={record?.notes || ''} maxLength={4000} placeholder="Agenda or preparation notes…" rows="3" /></FormField>
    </>}
  </FormShell>;
}
