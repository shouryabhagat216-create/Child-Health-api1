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
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.8 5.6a5.2 5.2 0 0 0-7.4 0L12 7l-1.4-1.4a5.2 5.2 0 0 0-7.4 7.4L12 21.6l8.8-8.6a5.2 5.2 0 0 0 0-7.4z" /><path d="M7 12h2.5l1.5-3 2 6 1.5-3H17" /></svg>
          </span>
          <h1>
            <span className="brand-name">WOMB<b>TO</b>18</span>
            <span className="brand-sub">Child Health prototype</span>
          </h1>
        </div>
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
              <span className="avatar-chip" aria-hidden="true">{guardian.displayName.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>
              {guardian.displayName} <button className="quiet" onClick={logout}>Log out</button>
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
