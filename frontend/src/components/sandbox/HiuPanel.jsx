import { useCallback, useEffect, useState } from 'react';
import { api, describeError } from '../../api.js';
import { ErrorLine, Field } from './common.jsx';

const today = () => new Date().toISOString().slice(0, 10);
const inAYear = () => new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();

// M3 as a HIU against the REAL ABDM sandbox: ask for consent to read this child's records held elsewhere,
// follow the decision, fetch EVERY granted artefact, and read the records that arrive (decrypted and checked).
export default function HiuPanel({ child }) {
  const base = `/hiu/children/${child.id}`;
  const [form, setForm] = useState({ abhaAddress: '', purposeCode: 'CAREMGT', dateFrom: '2020-01-01', dateTo: today() });
  const [requests, setRequests] = useState([]);
  const [records, setRecords] = useState([]);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    const [r, got] = await Promise.all([api('GET', `${base}/consent-requests`), api('GET', `${base}/records`)]);
    if (r.ok) setRequests(r.data.consentRequests);
    if (got.ok) setRecords(got.data.records);
  }, [base]);

  useEffect(() => { setMessage(null); setError(null); refresh(); }, [base, refresh]);
  const waiting = requests.some((r) => r.status === 'WAITING_FOR_CALLBACK');
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
  };

  const valid = /^[A-Za-z][A-Za-z0-9._]{2,}@(sbx|abdm)$/.test(form.abhaAddress) && form.dateFrom <= form.dateTo;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const tone = (s) => (s === 'GRANTED' ? 'good' : s === 'DENIED' || s === 'REVOKED' || s === 'EXPIRED' || s === 'FAILED' ? 'bad' : 'warn');

  return (
    <section className="card">
      <h2>Consent and records (M3, as a requester)</h2>
      <p className="notice">REAL ABDM SANDBOX. Needs a registered facility ID, linked to the bridge as HIU, in the server's facilities file, and ABDM_PUBLIC_BASE_URL set to this server's public https address.</p>

      <form className="form" onSubmit={(e) => { e.preventDefault(); run('POST', '/consent-requests', { ...form, dataEraseAt: inAYear() }, 'Consent request sent. The patient decides in their PHR app.'); }}>
        <Field label="Patient's ABHA address"><input value={form.abhaAddress} autoComplete="off" onChange={set('abhaAddress')} /></Field>
        <Field label="Purpose"><select value={form.purposeCode} onChange={set('purposeCode')}><option value="CAREMGT">Care Management</option><option value="PUBHLTH">Public Health</option><option value="HPAYMT">Healthcare Payment</option></select></Field>
        <div className="row">
          <Field label="Records from"><input type="date" value={form.dateFrom} onChange={set('dateFrom')} /></Field>
          <Field label="Records to"><input type="date" value={form.dateTo} max={today()} onChange={set('dateTo')} /></Field>
        </div>
        <p className="muted small">Immunisation records only. Data is kept for one year at most and removed sooner if the patient revokes.</p>
        <button className="primary" type="submit" disabled={!valid}>Ask for consent</button>
      </form>

      {message && <p className="ok">{message}</p>}
      <ErrorLine text={error} />

      <h3>Requests</h3>
      {requests.length === 0 && <p className="muted">None yet.</p>}
      <ul className="list">
        {requests.map((r) => (
          <li key={r.id} className="consent">
            <span className={`badge ${tone(r.status)}`}>{r.status}</span>
            {r.error && <span className="error"> {r.error.message} ({r.error.code})</span>}
            <div className="muted small">Artefacts: {r.artefacts.length}</div>
            <ul className="list">
              {r.artefacts.map((a) => (
                <li key={a.id}><span className={`badge ${tone(a.status)}`}>{a.status}</span>{a.fetched && ' detail fetched'}{a.error && <span className="error"> {a.error.message}</span>}</li>
              ))}
            </ul>
            <div className="row">
              <button disabled={!r.abdmConsentRequestId} onClick={() => run('POST', `/consent-requests/${r.id}/refresh`, undefined, 'Status requested.')}>Check status</button>
              <button className="primary" disabled={!r.artefacts.some((a) => a.status === 'GRANTED')} onClick={() => run('POST', `/consent-requests/${r.id}/fetch`, undefined, 'Fetching every granted artefact. Records arrive shortly.')}>Fetch the records</button>
            </div>
          </li>
        ))}
      </ul>

      <h3>Records received</h3>
      {records.length === 0 && <p className="muted">None yet.</p>}
      {records.map((rec) => (
        <details key={rec.id} className="logentry">
          <summary>{rec.careContextReference} · from {rec.hipId || 'a provider'} · {new Date(rec.receivedAt).toLocaleString()}</summary>
          <pre className="json">{JSON.stringify(rec.bundle, null, 2)}</pre>
        </details>
      ))}
    </section>
  );
}
