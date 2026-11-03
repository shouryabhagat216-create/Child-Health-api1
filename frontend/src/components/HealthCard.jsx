import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function HealthCard() {
  const [health, setHealth] = useState(null);

  const load = async () => setHealth((await api('GET', '/health')).data);
  useEffect(() => {
    load();
  }, []);

  const ok = health && health.status === 'ok';
  return (
    <section className="card">
      <h2>API health</h2>
      {!health && <p className="muted">Checking...</p>}
      {health && health.error && <p className="error">{health.error.message}</p>}
      {health && !health.error && (
        <p>
          <span className={`badge ${ok ? 'good' : 'bad'}`}>{health.status}</span> database:{' '}
          <strong>{health.database}</strong> · v{health.version}
        </p>
      )}
      <button onClick={load}>Re-check</button>
    </section>
  );
}
