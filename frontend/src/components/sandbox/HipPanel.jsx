import { useCallback, useEffect, useState } from 'react';
import { api, describeError } from '../../api.js';
import { ErrorLine, Field } from './common.jsx';

const ADDRESS_HINT = 'like name@sbx';

// M2 as a HIP against the REAL ABDM sandbox: tell the system which ABHA address is this child's, link the
// child's immunisation record to it (link token, then care context), and read the one-time code a patient needs
// to confirm a link started from their own PHR app.
export default function HipPanel({ child }) {
  const base = `/hip/children/${child.id}`;
  const [address, setAddress] = useState('');
  const [gender, setGender] = useState('M');
  const [status, setStatus] = useState(null);
  const [code, setCode] = useState(null);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    const res = await api('GET', `${base}/link-status`);
    if (res.ok) setStatus(res.data);
  }, [base]);

  useEffect(() => { setStatus(null); setCode(null); setMessage(null); setError(null); refresh(); }, [base, refresh]);
  // While ABDM is expected to call back, check again every few seconds.
  const waiting = status && (status.tokenStatus === 'WAITING_FOR_CALLBACK' || status.linkStatus === 'WAITING_FOR_CALLBACK');
  useEffect(() => {
    if (!waiting) return undefined;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [waiting, refresh]);

  const run = async (method, path, body, okText) => {
    setError(null);
    setMessage(null);
    const res = await api(method, `${base}${path}`, { body });
    if (res.ok) setMessage(okText);
    else setError(describeError(res));
    await refresh();
    return res;
  };

  const showCode = async () => {
    setError(null);
    const res = await api('GET', `${base}/link-code`);
    if (res.ok) setCode(res.data);
    else setError(describeError(res));
  };

  const validAddress = /^[A-Za-z][A-Za-z0-9._]{2,}@(sbx|abdm)$/.test(address);
  const badge = (v) => <span className={`badge ${v === 'LINKED' || v === 'RECEIVED' ? 'good' : v === 'FAILED' ? 'bad' : v === 'NONE' ? '' : 'warn'}`}>{v}</span>;

  return (
    <section className="card">
      <h2>Link records (M2, as a provider)</h2>
      <p className="notice">REAL ABDM SANDBOX. Needs a registered facility ID, linked to the bridge as HIP, in the server's facilities file. Without it ABDM refuses these steps.</p>

      <div className="step">
        <h3>1. This child's ABHA address</h3>
        <form className="form inline" onSubmit={(e) => { e.preventDefault(); run('POST', '/abha-address', { abhaAddress: address }, 'Address registered for patient searches.'); }}>
          <Field label="ABHA address" hint={ADDRESS_HINT}><input value={address} autoComplete="off" onChange={(e) => setAddress(e.target.value.trim())} /></Field>
          <button type="submit" disabled={!validAddress}>Register</button>
        </form>
      </div>

      <div className="step">
        <h3>2. Link from here (HIP-initiated)</h3>
        <div className="form inline">
          <Field label="Gender"><select value={gender} onChange={(e) => setGender(e.target.value)}><option value="M">M</option><option value="F">F</option><option value="O">O</option></select></Field>
          <button disabled={!validAddress} onClick={() => run('POST', '/link-token', { abhaAddress: address, gender }, 'Link token requested. ABDM answers on the bridge.')}>Request link token</button>
          <button className="primary" disabled={!validAddress || !status || status.tokenStatus !== 'RECEIVED'} onClick={() => run('POST', '/link-care-context', { abhaAddress: address }, 'Link sent. ABDM answers on the bridge.')}>Link care context</button>
        </div>
        {status && (
          <p>Link token: {badge(status.tokenStatus)} · Care context: {badge(status.linkStatus)}{waiting && <span className="muted"> · waiting for ABDM to call back…</span>}</p>
        )}
        {status && status.error && <p className="error">{status.error.message} ({status.error.code})</p>}
        <p className="muted small">A 202 from ABDM only means it received the request. The result is the status above.</p>
      </div>

      <div className="step">
        <h3>3. Link started from the patient's own app</h3>
        <p className="muted">When the patient searches for this facility in their PHR app and picks the immunisation record, ABDM asks for a code. Show it here, once, and tell the patient.</p>
        <button onClick={showCode}>Show the link code</button>
        {code && (
          <p role="status">Code: <strong className="code">{code.otp}</strong> <span className="muted small">(shown once, valid until {new Date(code.expiresAt).toLocaleTimeString()})</span></p>
        )}
      </div>

      {message && <p className="ok">{message}</p>}
      <ErrorLine text={error} />
    </section>
  );
}
