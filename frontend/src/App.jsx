import { useCallback, useEffect, useState } from 'react';
import { api, onResponse, setToken } from './api.js';
import { SCENARIOS } from './states.js';
import HealthPill from './components/HealthCard.jsx';
import LoginPanel from './components/LoginPanel.jsx';
import ChildrenPanel from './components/ChildrenPanel.jsx';
import AbdmPanel from './components/AbdmPanel.jsx';
import SandboxPanel from './components/sandbox/SandboxPanel.jsx';

const MAX_LOG = 20;

export default function App() {
  const [guardian, setGuardian] = useState(null);
  const [children, setChildren] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [scenario, setScenario] = useState('success');
  const [tab, setTab] = useState('children');
  const [log, setLog] = useState([]); // most recent API calls, newest first

  useEffect(() => onResponse((entry) => setLog((old) => [{ ...entry, at: new Date() }, ...old].slice(0, MAX_LOG))), []);

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
    setToken(null);
    setGuardian(null);
    setChildren([]);
    setSelectedId(null);
    setTab('children');
  };

  const selected = children.find((c) => c.id === selectedId);
  const TABS = [
    ['children', 'Children'],
    ['abdm', 'ABDM simulation (mock)'],
    ['sandbox', 'ABDM sandbox (real)'],
    ['log', `API log${log.length ? ` (${log.length})` : ''}`],
  ];

  return (
    <>
      <div className={`banner${tab === 'sandbox' ? ' sandbox' : ''}`}>{tab === 'sandbox' ? 'ABDM SANDBOX · real calls to ABDM\'s test environment · use test identities only' : 'MOCK MODE · synthetic data only'}</div>
      <header className="topbar">
        <h1>Child Health Dashboard</h1>
        <div className="topbar-right">
          <HealthPill />
          <label className="scenario">
            Scenario
            <select value={scenario} onChange={(e) => setScenario(e.target.value)}>
              {SCENARIOS.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          {guardian && (
            <span className="user">
              {guardian.displayName} <button onClick={logout}>Log out</button>
            </span>
          )}
        </div>
      </header>

      <main className="container">
        {!guardian && <LoginPanel onLogin={setGuardian} />}

        {guardian && (
          <>
            <div className="childbar">
              <label>
                Selected child
                <select value={selectedId || ''} onChange={(e) => setSelectedId(e.target.value || null)}>
                  <option value="">{children.length ? 'Choose a child...' : 'No children yet'}</option>
                  {children.map((c) => <option key={c.id} value={c.id}>{c.name} (born {c.dateOfBirth})</option>)}
                </select>
              </label>
            </div>

            <nav className="tabs" role="tablist">
              {TABS.map(([id, label]) => (
                <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
                  {label}
                </button>
              ))}
            </nav>

            {tab === 'children' && (
              <ChildrenPanel children={children} selectedId={selectedId} onSelect={setSelectedId} onChanged={loadChildren} />
            )}

            {tab === 'abdm' && (
              selected
                ? <AbdmPanel child={selected} scenario={scenario} />
                : <section className="card"><p className="muted">Select or register a child first (Children tab).</p></section>
            )}

            {tab === 'sandbox' && (
              selected
                ? <SandboxPanel child={selected} guardian={guardian} />
                : <section className="card"><p className="muted">Select or register a child first (Children tab).</p></section>
            )}

            {tab === 'log' && (
              <section className="card">
                <h2>API log</h2>
                                {log.length === 0 && <p className="muted">No calls yet.</p>}
                {log.map((e, i) => (
                  <details key={i} open={i === 0} className="logentry">
                    <summary>
                      <span className={`badge ${e.status >= 200 && e.status < 300 ? 'good' : e.status >= 400 || e.status === 0 ? 'bad' : 'warn'}`}>{e.status}</span>{' '}
                      <code>{e.method} {e.path}</code>
                      {e.scenario && <> · scenario {e.scenario}</>}
                      <span className="muted"> · {e.at.toLocaleTimeString()}</span>
                    </summary>
                    <pre className="json">{JSON.stringify(e.data, null, 2)}</pre>
                  </details>
                ))}
              </section>
            )}
          </>
        )}
      </main>
    </>
  );
}
