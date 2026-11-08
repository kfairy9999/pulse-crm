import { useEffect, useId, useRef } from 'react';
import { AlertCircle, Check, ChevronDown, Inbox, LoaderCircle, X, CheckSquare, Square } from 'lucide-react';
import { initials } from '../api.js';

const avatarColors = ['peach', 'mint', 'sand', 'sky', 'rose'];
export function Avatar({ name, size = 'medium' }) {
  const sum = (name || '').split('').reduce((acc, letter) => acc + letter.charCodeAt(0), 0);
  return <span className={`avatar ${avatarColors[sum % avatarColors.length]} avatar-${size}`}>{initials(name)}</span>;
}

export function Button({ children, variant = 'secondary', icon: Icon, className = '', loading = false, ...props }) {
  return <button type={props.type || 'button'} className={`button button-${variant} ${className}`} disabled={loading || props.disabled} {...props}>
    {loading ? <LoaderCircle size={16} className="spin" /> : Icon && <Icon size={16} strokeWidth={2} />}{children}
  </button>;
}

export function IconButton({ label, children, className = '', ...props }) {
  return <button type="button" className={`icon-button ${className}`} aria-label={label} title={label} {...props}>{children}</button>;
}

export function Tag({ children, tone = 'default', onRemove }) {
  return <span className={`tag tag-${tone}`}>{children}{onRemove && <button onClick={onRemove} aria-label={`Remove ${children}`}><X size={11} /></button>}</span>;
}

export function Pill({ children, tone = 'neutral', dot = false }) {
  return <span className={`pill pill-${tone}`}>{dot && <span className="status-dot" />}{children}</span>;
}

export function Modal({ title, eyebrow, onClose, children, wide = false }) {
  const titleId = useId();
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = dialogRef.current;
    const focusableSelector = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]';
    const firstInput = dialog?.querySelector('input:not(:disabled), textarea:not(:disabled)');
    (firstInput || dialog?.querySelector('button'))?.focus();
    const onKey = (event) => {
      if (event.key === 'Escape') onCloseRef.current();
      if (event.key !== 'Tab') return;
      const focusable = [...(dialog?.querySelectorAll(focusableSelector) || [])].filter((element) => !element.closest('[aria-hidden="true"]'));
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = previousOverflow; if (previous?.isConnected) previous.focus?.(); };
  }, []);
  return <div className="overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className="modal-header"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2 id={titleId}>{title}</h2></div><IconButton label="Close dialog" onClick={onClose}><X size={20} /></IconButton></header>
      {children}
    </section>
  </div>;
}

export function FormField({ label, error, children, optional = false, className = '', hint }) {
  return <label className={`field ${className}`}><span className="field-label">{label}{optional && <span className="optional">Optional</span>}</span>{children}{hint && !error && <span className="field-hint">{hint}</span>}{error && <span className="field-error">{error}</span>}</label>;
}

export function Select({ children, className = '', ...props }) {
  return <span className={`select-wrap ${className}`}><select {...props}>{children}</select><ChevronDown size={14} aria-hidden="true" /></span>;
}

export function SearchInput({ placeholder = 'Search', ...props }) {
  return <div className="search-input"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg><input type="search" placeholder={placeholder} aria-label={placeholder} {...props} /></div>;
}

export function EmptyState({ title, description, action: Action, icon: Icon = Inbox }) {
  return <div className="empty-state"><span className="empty-icon"><Icon size={24} /></span><h3>{title}</h3><p>{description}</p>{Action}</div>;
}

export function ErrorState({ error, retry }) {
  return <div className="state-card" role="alert"><AlertCircle size={28} /><h3>This view didn’t open</h3><p>{error?.message || 'Something interrupted the load.'} Your records are still safe.</p><Button onClick={() => retry()}>Try again</Button></div>;
}

export function LoadingState({ label = 'Getting your workspace ready' }) {
  return <div className="loading-state" role="status"><LoaderCircle className="spin" size={23} /><span>{label}…</span></div>;
}

export function ConfirmDialog({ title, description, confirmLabel = 'Delete', onConfirm, onClose, busy }) {
  return <Modal title={title} eyebrow="Please double-check" onClose={onClose}><p className="confirm-description">{description}</p><div className="modal-actions"><Button onClick={onClose} disabled={busy}>Keep it</Button><Button variant="danger" onClick={onConfirm} loading={busy}>{confirmLabel}</Button></div></Modal>;
}

export function Checkmark() { return <span className="success-check"><Check size={20} /></span>; }

export function TaskCheckbox({ task, onToggle, busy = false }) {
  return <button className={`task-checkbox ${task.status === 'Completed' ? 'is-complete' : ''}`} onClick={() => onToggle(task)} disabled={busy} aria-label={task.status === 'Completed' ? `Reopen ${task.title}` : `Complete ${task.title}`} title={task.status === 'Completed' ? 'Reopen task' : 'Mark complete'}>{task.status === 'Completed' ? <CheckSquare size={19} /> : <Square size={19} />}</button>;
}
