import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api.js';
import { explain } from './common.jsx';
import { Alert, Spinner } from './ui.jsx';

const tone = (v) => (v === 'LINKED' || v === 'RECEIVED' ? 'good' : v === 'FAILED' ? 'bad' : v === 'NONE' ? '' : 'warn');
const WORDS = { NONE: 'Not started', WAITING_FOR_CALLBACK: 'Waiting for ABDM', RECEIVED: 'Received', LINKED: 'Linked', FAILED: 'Failed' };
const ADDRESS_OK = /^[A-Za-z][A-Za-z0-9._]{2,}@(sbx|abdm)$/;

function Status({ label, value }) {
  return <span className="statusline">{label}: <span className={`badge ${tone(value)}`}>{WORDS[value] || value}</span></span>;
}

// M2 as a HIP against the REAL ABDM sandbox: say which ABHA address is this child's, link the child's
// immunisation record to it (link token, then care context), and read the one-time code a patient needs to confirm a
// link they started from their own PHR app.
export default function HipPanel({ child }) {
  const base = `/hip/children/${child.id}`;
  const [address, setAddress] = useState('');
  const [registered, setRegistered] = useState(false);
  const [gender, setGender] = useState('M');
  const [status, setStatus] = useState(null);
  const [code, setCode] = useState(null);
  const [note, setNote] = useState(null); // { kind, title, text }
  const [busy, setBusy] = useState('');

  const refresh = useCallback(async () => {
    const res = await api('GET', `${base}/link-status`);
    if (res.ok) setStatus(res.data);
  }, [base]);

  useEffect(() => { setStatus(null); setCode(null); setNote(null); setRegistered(false); refresh(); }, [base, refresh]);
  const waiting = status && (status.tokenStatus === 'WAITING_FOR_CALLBACK' || status.linkStatus === 'WAITING_FOR_CALLBACK');
  useEffect(() => {
    if (!waiting) return undefined;
    const t = setInterval(refresh, 3000); // ABDM answers on the bridge, so look again every few seconds
    return () => clearInterval(t);
  }, [waiting, refresh]);

  const run = async (key, method, path, body, okText, after) => {
    setNote(null);
    setBusy(key);
    const res = await api(method, `${base}${path}`, { body });
    setBusy('');
    if (res.ok) { setNote({ kind: 'success', text: okText }); if (after) after(res); } else setNote(explain(res));
    await refresh();
  };

  const valid = ADDRESS_OK.test(address);
  const tokenReady = status && status.tokenStatus === 'RECEIVED';

  return (
    <section className="card">
      <div className="sectionhead">
        <h2>Link records (M2, as a provider)</h2>
        <span className="envchip">SANDBOX</span>
      </div>
      <p className="lead">Make this child's immunisation record findable from their ABHA, under the patient's consent.</p>
      <Alert kind="warning" title="Needs a registered facility">A facility ID linked to the bridge as a HIP must be in the server's facilities file. Without it ABDM refuses these steps.</Alert>

      <ol className="numbered">
        <li className="step">
          <h3><span className="num">1</span> This child's ABHA address</h3>
          <form className="form" onSubmit={(e) => { e.preventDefault(); run('addr', 'POST', '/abha-address', { abhaAddress: address }, 'Address saved. It is used to match searches from PHR apps.', () => setRegistered(true)); }}>
            <div className="field">
              <label htmlFor="hip-address">ABHA address</label>
              <div className="field-row">
                <input id="hip-address" value={address} autoComplete="off" placeholder="name@sbx" className={address && !valid ? 'invalid' : ''} onChange={(e) => { setAddress(e.target.value.trim()); setRegistered(false); }} />
                <button type="submit" disabled={!valid || busy === 'addr'}>{busy === 'addr' ? <Spinner /> : registered ? 'Saved' : 'Save'}</button>
              </div>
              <span className="hint">The address the child's ABHA already has, such as name@sbx.</span>
            </div>
          </form>
        </li>

        <li className="step">
          <h3><span className="num">2</span> Link from here</h3>
          <p className="muted">Ask ABDM for a link token for the patient, then send the care context with it.</p>
          <div className="actions">
            <label className="inlinefield">Gender
              <select value={gender} onChange={(e) => setGender(e.target.value)}><option value="M">Male</option><option value="F">Female</option><option value="O">Other</option></select>
            </label>
            <button disabled={!valid || busy === 'token'} onClick={() => run('token', 'POST', '/link-token', { abhaAddress: address, gender }, 'Link token requested. ABDM answers on the bridge.')}>{busy === 'token' ? <Spinner /> : 'Request link token'}</button>
            <button className="primary" disabled={!valid || !tokenReady || busy === 'link'} onClick={() => run('link', 'POST', '/link-care-context', { abhaAddress: address }, 'Link sent. ABDM answers on the bridge.')}>{busy === 'link' ? <Spinner /> : 'Link care context'}</button>
          </div>
          {status && (
            <p className="statuses">
              <Status label="Link token" value={status.tokenStatus} />
              <Status label="Care context" value={status.linkStatus} />
              {waiting && <span className="muted"><Spinner label="Waiting" /> waiting for ABDM to call back…</span>}
            </p>
          )}
          {status?.error && <Alert kind="error" title={`ABDM answered: ${status.error.code}`}>{status.error.message}</Alert>}
          <p className="muted small">A 202 from ABDM only means it received the request. The result is the status shown here.</p>
        </li>

        <li className="step">
          <h3><span className="num">3</span> The patient links from their own app</h3>
          <p className="muted">When the patient searches for this facility in their PHR app and picks the immunisation record, ABDM asks for a code. Show it here, once, and tell the patient.</p>
          <button onClick={async () => { setNote(null); const res = await api('GET', `${base}/link-code`); if (res.ok) setCode(res.data); else setNote(explain(res)); }}>Show the link code</button>
          {code && (
            <div className="codebox" role="status">
              <span className="code">{code.otp}</span>
              <span className="muted small">Shown once. Valid until {new Date(code.expiresAt).toLocaleTimeString()}.</span>
            </div>
          )}
        </li>
      </ol>

      {note && <Alert kind={note.kind} title={note.title}>{note.text}</Alert>}
    </section>
  );
}
