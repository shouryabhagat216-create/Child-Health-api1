import { useEffect, useState } from 'react';
import { api } from '../api.js';

// Compact status pill for the header. Click it to re-check.
export default function HealthPill() {
  const [health, setHealth] = useState(null);

  const load = async () => setHealth((await api('GET', '/health')).data);
  useEffect(() => {
    load();
  }, []);

  let label = 'API checking...';
  let tone = 'warn';
  if (health && health.error) {
    label = 'API unreachable';
    tone = 'bad';
  } else if (health) {
    const ok = health.status === 'ok';
    label = ok ? 'API ok' : `API ${health.status} · database ${health.database}`;
    tone = ok ? 'good' : 'bad';
  }
  return (
    <button className={`pill ${tone}`} onClick={load} title="Click to re-check /health">
      <span className="dot" /> {label}
    </button>
  );
}
