import { useEffect, useRef, useState } from 'react';

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
  return text ? <p className="error" role="alert">{text}</p> : null;
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
