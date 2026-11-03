import { useEffect, useRef, useState } from 'react';
import { describeError } from '../../api.js';
import { Alert } from './ui.jsx';

// Counts down from `seconds`; restart() starts again. Used for the 60 second wait before Resend OTP.
export function useCountdown() {
  const [left, setLeft] = useState(0);
  const timer = useRef(null);
  useEffect(() => () => clearInterval(timer.current), []);
  const restart = (seconds) => {
    clearInterval(timer.current);
    setLeft(seconds);
    timer.current = setInterval(() => setLeft((n) => (n <= 1 ? (clearInterval(timer.current), 0) : n - 1)), 1000);
  };
  return [left, restart];
}

// An error is shown on the screen the person is looking at, in ABDM's own words.
export function ErrorLine({ text }) {
  return text ? <Alert kind="error">{text}</Alert> : null;
}

// Setup problems get a plain explanation of what to do. Anything else is shown as ABDM said it.
export function explain(res) {
  const e = (res && res.data && res.data.error) || {};
  const setup = {
    SANDBOX_NOT_ENABLED: ['Sandbox mode is off', 'Set ABDM_MODE=sandbox (with the sandbox credentials) in the server .env file, then restart the server.'],
    NO_HIP_FACILITY: ['No provider facility is set up', 'Add your registered facility ID, linked to the bridge as a HIP, to backend/config/facilities.json.'],
    NO_HIU_FACILITY: ['No requester facility is set up', 'Add your registered facility ID, linked to the bridge as a HIU, to backend/config/facilities.json.'],
    NO_PUBLIC_URL: ['No public address', 'Set ABDM_PUBLIC_BASE_URL to this server\'s public https address and restart the server.'],
  }[e.code];
  return setup ? { kind: 'warning', title: setup[0], text: setup[1] } : { kind: 'error', title: null, text: describeError(res) };
}

export function Field({ label, hint, children }) {
  return (
    <label>
      {label}
      {children}
      {hint && <span className="muted small">{hint}</span>}
    </label>
  );
}

// A read-only value that came from the ABHA profile, with where it came from.
export function ProfileRow({ label, value, source = 'from the ABHA profile' }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <tr>
      <th scope="row">{label}</th>
      <td><input readOnly value={value} aria-label={label} /></td>
      <td className="muted small">{source}</td>
    </tr>
  );
}
