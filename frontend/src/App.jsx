import { useCallback, useEffect, useState } from 'react';
import { api, onResponse } from './api.js';
import { SCENARIOS } from './states.js';
import HealthCard from './components/HealthCard.jsx';
import LoginPanel from './components/LoginPanel.jsx';
import ChildrenPanel from './components/ChildrenPanel.jsx';
import AbdmPanel from './components/AbdmPanel.jsx';

export default function App() {
  const [guardian, setGuardian] = useState(null);
  const [children, setChildren] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [scenario, setScenario] = useState('success');
  const [last, setLast] = useState(null);

  useEffect(() => onResponse(setLast), []);

  const loadChildren = useCallback(async (selectId) => {
    const res = await api('GET', '/children');
    if (res.ok) {
      setChildren(res.data.children);
      if (selectId) setSelectedId(selectId);
    }
  }, []);

  useEffect(() => {
    if (guardian) loadChildren();
  }, [guardian, loadChildren]);

  const logout = () => {
    setGuardian(null);
    setChildren([]);
    setSelectedId(null);
  };

  const selected = children.find((c) => c.id === selectedId);

  return (
    <>
      <div className="banner">
        MOCK MODE: synthetic data only. Not connected to the real ABDM or any live system.
      </div>
      <header>
        <h1>Child Health Dashboard</h1>
        <label>
          Mock gateway scenario{' '}
          <select value={scenario} onChange={(e) => setScenario(e.target.value)}>
            {SCENARIOS.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
      </header>
      <main>
        <HealthCard />
        <LoginPanel guardian={guardian} onLogin={setGuardian} onLogout={logout} />
        {guardian && (
          <ChildrenPanel children={children} selectedId={selectedId} onSelect={setSelectedId} onChanged={loadChildren} />
        )}
        {guardian && selected && <AbdmPanel child={selected} scenario={scenario} />}
        <section className="card wide">
          <h2>Last API response</h2>
          {last ? (
            <>
              <p>
                <code>{last.method} {last.path}</code> → <strong>{last.status}</strong>
                {last.scenario && <> · scenario {last.scenario}</>}
              </p>
              <pre className="json">{JSON.stringify(last.data, null, 2)}</pre>
            </>
          ) : <p className="muted">Nothing yet.</p>}
        </section>
      </main>
    </>
  );
}
