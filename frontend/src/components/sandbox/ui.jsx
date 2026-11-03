import { useRef, useState } from 'react';

// Small building blocks shared by the sandbox screens.

// Numbered progress: done steps get a tick, the current one is highlighted.
export function Stepper({ steps, current }) {
  const at = steps.findIndex(([id]) => id === current);
  return (
    <ol className="stepper" aria-label="Progress">
      {steps.map(([id, label], i) => {
        const state = i < at ? 'done' : i === at ? 'now' : 'todo';
        return (
          <li key={id} className={state} aria-current={state === 'now' ? 'step' : undefined}>
            <span className="dot" aria-hidden="true">{state === 'done' ? '✓' : i + 1}</span>
            <span className="label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

const ICONS = { error: '!', warning: '!', info: 'i', success: '✓' };
// A message in a box that says what kind it is. Errors are announced to screen readers.
export function Alert({ kind = 'info', title, children }) {
  if (!children && !title) return null;
  return (
    <div className={`alert ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <span className="icon" aria-hidden="true">{ICONS[kind]}</span>
      <div>{title && <strong>{title}</strong>}{children && <div>{children}</div>}</div>
    </div>
  );
}

export function Spinner({ label = 'Loading' }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

// Six boxes for a one-time password: typing moves on, Backspace goes back, and a whole code (pasted, or filled in by
// the phone's SMS autofill) spreads across all six.
export function OtpInput({ value, onChange, disabled, label = 'One-time password' }) {
  const refs = useRef([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] || '');
  const focus = (i) => refs.current[Math.max(0, Math.min(5, i))]?.focus();
  const put = (i, d) => {
    const next = digits.slice();
    next[i] = d;
    onChange(next.join('').slice(0, 6));
  };
  return (
    <div className="otp" role="group" aria-label={label}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          type="password"
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          value={d}
          disabled={disabled}
          aria-label={`${label}, digit ${i + 1} of 6`}
          onChange={(e) => {
            const typed = e.target.value.replace(/\D/g, '');
            if (typed.length > 1) {
              // a whole code arrived at once (SMS autofill, or a paste into one box): spread it from this box
              onChange((digits.slice(0, i).join('') + typed).slice(0, 6));
              focus(i + typed.length);
              return;
            }
            put(i, typed);
            if (typed) focus(i + 1);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !d) { put(Math.max(0, i - 1), ''); focus(i - 1); }
            if (e.key === 'ArrowLeft') focus(i - 1);
            if (e.key === 'ArrowRight') focus(i + 1);
          }}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
            if (!pasted) return;
            e.preventDefault();
            onChange(pasted);
            focus(pasted.length);
          }}
          onFocus={(e) => e.target.select()}
        />
      ))}
    </div>
  );
}

// Big selectable cards instead of bare radio buttons.
export function ChoiceCards({ name, value, onChange, options, legend }) {
  return (
    <fieldset className="choices">
      <legend>{legend}</legend>
      {options.map((o) => (
        <label key={o.value} className={`choice${value === o.value ? ' picked' : ''}`}>
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
          <span>
            <strong>{o.title}</strong>
            <span className="muted small">{o.detail}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function CopyButton({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="quiet" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard may be blocked */ }
    }}>{done ? 'Copied' : label}</button>
  );
}

export const groupAbha = (n) => {
  const d = String(n || '').replace(/\D/g, '');
  return d.length === 14 ? `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6, 10)}-${d.slice(10)}` : String(n || '');
};
const GENDER = { M: 'Male', F: 'Female', O: 'Other' };
const initials = (name) => (String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('') || '?').toUpperCase();

// The person's ABHA in one place: who, the number, the address, and the details that came from the profile.
// Fields from Aadhaar are read only and say so.
export function ProfileCard({ name, abhaNumber, abhaAddress, status, kycVerified, details = [] }) {
  return (
    <article className="profile" aria-label="ABHA profile">
      <header>
        <span className="avatar" aria-hidden="true">{initials(name)}</span>
        <div className="who">
          <h3>{name || 'ABHA account'}</h3>
          <div className="abha-number" aria-label="ABHA number">
            <code>{groupAbha(abhaNumber)}</code>
            {abhaNumber && <CopyButton text={groupAbha(abhaNumber)} />}
          </div>
          {abhaAddress && <div className="muted">{abhaAddress}</div>}
        </div>
        <div className="badges">
          {status && <span className={`badge ${status === 'ACTIVE' ? 'good' : 'warn'}`}>{status}</span>}
          {kycVerified === true && <span className="badge good">KYC verified</span>}
          {kycVerified === false && <span className="badge warn">Not KYC verified</span>}
        </div>
      </header>
      {details.length > 0 && (
        <dl className="details">
          {details.filter((d) => d.value).map((d) => (
            <div key={d.label}>
              <dt>{d.label}{d.locked && <span className="lock" title="Comes from Aadhaar. Read only.">{' '}read only</span>}</dt>
              <dd>{d.label === 'Gender' ? GENDER[d.value] || d.value : d.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </article>
  );
}
