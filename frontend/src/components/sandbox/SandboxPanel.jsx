import { useState } from 'react';
import CreateAbha from './CreateAbha.jsx';
import LoginAbha from './LoginAbha.jsx';
import HipPanel from './HipPanel.jsx';
import HiuPanel from './HiuPanel.jsx';

const TABS = [
  ['create', 'Create ABHA'],
  ['login', 'Log in with ABHA number'],
  ['hip', 'Link records (M2)'],
  ['hiu', 'Consent and records (M3)'],
];

// The real ABDM sandbox, kept apart from the mock simulation tab and labelled so the two cannot be confused.
export default function SandboxPanel({ child, guardian }) {
  const [tab, setTab] = useState('create');
  return (
    <>
      <nav className="tabs inner" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>
      {tab === 'create' && <CreateAbha child={child} guardian={guardian} />}
      {tab === 'login' && <LoginAbha child={child} goTo={setTab} />}
      {tab === 'hip' && <HipPanel child={child} />}
      {tab === 'hiu' && <HiuPanel child={child} />}
    </>
  );
}
