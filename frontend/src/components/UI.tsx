import { useEffect, useState, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'quiet' };

/** Use for an action; reserve primary styling for the single most important action on a screen. */
export function Button({ variant = 'secondary', className = '', ...props }: ButtonProps) {
  return <button className={`button button--${variant} ${className}`} {...props} />;
}

/** Use to group related information without adding unnecessary decoration. */
export function Card({ children, className = '', ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={`card ${className}`} {...props}>{children}</section>;
}

const statusIcon: Record<string, string> = { normal: '✓', low: '↓', high: '↑', critical: '!', pending: '…', delivered: '✓' };

/** Always pair status text with an icon so meaning never depends on colour alone. */
export function StatusChip({ status, children }: { status: string; children: ReactNode }) {
  return <span className={`status-chip status-chip--${status}`}><span aria-hidden="true">{statusIcon[status] ?? '•'}</span>{children}</span>;
}

/** Use a visible label and a short, specific helper or error message. */
export function Input({ label, error, id, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) {
  const inputId = id ?? props.name ?? label.toLowerCase().replace(/\s+/g, '-');
  return <label className="field" htmlFor={inputId}>
    <span className="field__label">{label}</span>
    <input id={inputId} className="control" aria-invalid={Boolean(error)} aria-describedby={error ? `${inputId}-error` : undefined} {...props} />
    {error && <span id={`${inputId}-error`} className="field__error">{error}</span>}
  </label>;
}

/** Use for one-time passwords; input remains a single accessible field for assistive technology. */
export function OtpInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'inputMode' | 'maxLength'> & { label?: string }) {
  return <Input label={props.label ?? 'One-time password'} type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} {...props} />;
}

/** Use for a finite set of choices and keep the label visible. */
export function Select({ label, id, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: ReactNode }) {
  const selectId = id ?? props.name ?? label.toLowerCase().replace(/\s+/g, '-');
  return <label className="field" htmlFor={selectId}>
    <span className="field__label">{label}</span>
    <select id={selectId} className="control" {...props}>{children}</select>
  </label>;
}

/** Reserve the final content shape while loading to reduce layout shift. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <span className={`skeleton ${className}`} aria-hidden="true" />;
}

/** Use when there is nothing to show and give the patient one clear next step. */
export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return <Card className="state-card"><span className="state-icon" aria-hidden="true">○</span><h2>{title}</h2><p>{children}</p></Card>;
}

/** Use when an operation failed and provide a recovery action. */
export function ErrorState({ title, onRetry }: { title: string; onRetry: () => void }) {
  return <Card className="state-card"><span className="state-icon" aria-hidden="true">!</span><h2>{title}</h2><Button variant="secondary" onClick={onRetry}>Try again</Button></Card>;
}

/** Use for brief feedback; render the message in a live region. */
export function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 4_000);
    return () => window.clearTimeout(timer);
  }, [message, onClose]);
  return <div role="status" aria-live="polite" aria-atomic="true" className="toast"><span>{message}</span><button aria-label="Dismiss notification" onClick={onClose}>×</button></div>;
}

/** Use in staff-only views; smaller type is limited to dense operational tables. */
export function Table({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  return <div className="table-scroll"><table className="data-table"><thead><tr>{headers.map((header) => <th key={header} scope="col">{header}</th>)}</tr></thead>
    <tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex} data-label={headers[cellIndex]}>{cell}</td>)}</tr>)}</tbody>
  </table></div>;
}

/** Offer three patient-facing themes using names as well as an Aa preview. */
export function ThemeSwitcher({ theme, onChange }: { theme: string; onChange: (value: 'clarity' | 'large' | 'night') => void }) {
  return <details className="theme-switcher">
    <summary role="button" aria-label="Aa appearance and text size"><span aria-hidden="true" className="theme-switcher__aa">Aa</span></summary>
    <div className="theme-switcher__menu" role="group" aria-label="Text size and appearance">
      {(['clarity', 'large', 'night'] as const).map((option) => <button key={option} type="button" aria-pressed={theme === option} onClick={() => onChange(option)}>
        {option === 'clarity' ? 'Standard' : option === 'large' ? 'Larger text' : 'Night'}
      </button>)}
    </div>
  </details>;
}

export function useToast() {
  const [message, setMessage] = useState('');
  const toast = message ? <Toast message={message} onClose={() => setMessage('')} /> : null;
  return { showToast: setMessage, toast };
}
