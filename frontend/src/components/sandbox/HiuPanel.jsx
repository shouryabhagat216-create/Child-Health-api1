import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api.js';
import { explain } from './common.jsx';
import { Alert, Spinner } from './ui.jsx';

const today = () => new Date().toISOString().slice(0, 10);
const inAYear = () => new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
const tone = (s) => (s === 'GRANTED' ? 'good' : ['DENIED', 'REVOKED', 'EXPIRED', 'FAILED'].includes(s) ? 'bad' : 'warn');
const WORDS = { WAITING_FOR_CALLBACK: 'Waiting for ABDM', REQUESTED: 'Waiting for the patient', GRANTED: 'Granted', DENIED: 'Denied', REVOKED: 'Revoked', EXPIRED: 'Expired', FAILED: 'Failed' };
const ADDRESS_OK = /^[A-Za-z][A-Za-z0-9._]{2,}@(sbx|abdm)$/;

// M3 as a HIU against the REAL ABDM sandbox: ask for consent to read this child's records held elsewhere,
// follow the decision, fetch EVERY granted artefact, and read the records that arrive (decrypted and checked).
export default function HiuPanel({ child }) {
  const base = `/hiu/children/${child.id}`;
  const [form, setForm] = useState({ abhaAddress: '', purposeCode: 'CAREMGT', dateFrom: '2020-01-01', dateTo: today() });
  const [requests, setRequests] = useState([]);
  const [records, setRecords] = useState([]);
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState('');

  const refresh = useCallback(async () => {
    const [r, got] = await Promise.all([api('GET', `${base}/consent-requests`), api('GET', `${base}/records`)]);
    if (r.ok) setRequests(r.data.consentRequests);
    if (got.ok) setRecords(got.data.records);
  }, [base]);

  useEffect(() => { setNote(null); refresh(); }, [base, refresh]);
  const waiting = requests.some((r) => r.status === 'WAITING_FOR_CALLBACK');
  useEffect(() => {
    if (!waiting) return undefined;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [waiting, refresh]);

  const run = async (key, method, path, body, okText) => {
    setNote(null);
    setBusy(key);
    const res = await api(method, `${base}${path}`, { body });
    setBusy('');
    setNote(res.ok ? { kind: 'success', text: okText } : explain(res));
    await refresh();
  };

  const datesOk = form.dateFrom <= form.dateTo;
  const valid = ADDRESS_OK.test(form.abhaAddress) && datesOk;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <section className="card">
      <div className="sectionhead">
        <h2>Consent and records (M3, as a requester)</h2>
        <span className="envchip">SANDBOX</span>
      </div>
      <p className="lead">Ask the patient for permission to read this child's immunisation records held by another provider.</p>
      <Alert kind="warning" title="Needs setup">A registered facility ID linked to the bridge as a HIU in the server's facilities file, and ABDM_PUBLIC_BASE_URL set to this server's public https address.</Alert>

      <form className="form" onSubmit={(e) => { e.preventDefault(); run('ask', 'POST', '/consent-requests', { ...form, dataEraseAt: inAYear() }, 'Consent request sent. The patient decides in their PHR app.'); }}>
        <div className="field">
          <label htmlFor="hiu-address">Patient's ABHA address</label>
          <input id="hiu-address" value={form.abhaAddress} autoComplete="off" placeholder="name@sbx" className={form.abhaAddress && !ADDRESS_OK.test(form.abhaAddress) ? 'invalid' : ''} onChange={set('abhaAddress')} />
        </div>
        <div className="field">
          <label htmlFor="hiu-purpose">Purpose</label>
          <select id="hiu-purpose" value={form.purposeCode} onChange={set('purposeCode')}><option value="CAREMGT">Care Management</option><option value="PUBHLTH">Public Health</option><option value="HPAYMT">Healthcare Payment</option></select>
        </div>
        <div className="field-row">
          <div className="field"><label htmlFor="hiu-from">Records from</label><input id="hiu-from" type="date" value={form.dateFrom} onChange={set('dateFrom')} /></div>
          <div className="field"><label htmlFor="hiu-to">Records to</label><input id="hiu-to" type="date" value={form.dateTo} max={today()} onChange={set('dateTo')} className={datesOk ? '' : 'invalid'} /></div>
        </div>
        {!datesOk && <Alert kind="error">The start date must not be after the end date.</Alert>}
        <p className="muted small">Immunisation records only. Data is kept for one year at most, and removed sooner if the patient revokes.</p>
        <div className="actions"><button className="primary" type="submit" disabled={!valid || busy === 'ask'}>{busy === 'ask' ? <><Spinner /> Sending…</> : 'Ask for consent'}</button></div>
      </form>

      {note && <Alert kind={note.kind} title={note.title}>{note.text}</Alert>}

      <h3>Requests</h3>
      {requests.length === 0 && <p className="muted">No requests yet. Ask for consent above and it will appear here.</p>}
      <ul className="list">
        {requests.map((r) => (
          <li key={r.id} className="consent">
            <div className="actions">
              <span className={`badge ${tone(r.status)}`}>{WORDS[r.status] || r.status}</span>
              <span className="muted small">{r.artefacts.length} consent artefact{r.artefacts.length === 1 ? '' : 's'}</span>
              {r.status === 'WAITING_FOR_CALLBACK' && <Spinner label="Waiting" />}
            </div>
            {r.error && <Alert kind="error" title={`ABDM answered: ${r.error.code}`}>{r.error.message}</Alert>}
            {r.artefacts.length > 0 && (
              <ul className="list">
                {r.artefacts.map((a) => (
                  <li key={a.id}><span className={`badge ${tone(a.status)}`}>{WORDS[a.status] || a.status}</span> <span className="muted small">{a.fetched ? 'details fetched' : 'details not fetched yet'}</span>{a.error && <Alert kind="error">{a.error.message}</Alert>}</li>
                ))}
              </ul>
            )}
            <div className="actions">
              <button disabled={!r.abdmConsentRequestId || busy === `s${r.id}`} onClick={() => run(`s${r.id}`, 'POST', `/consent-requests/${r.id}/refresh`, undefined, 'Status requested.')}>Check status</button>
              <button className="primary" disabled={!r.artefacts.some((a) => a.status === 'GRANTED') || busy === `f${r.id}`} onClick={() => run(`f${r.id}`, 'POST', `/consent-requests/${r.id}/fetch`, undefined, 'Fetching every granted artefact. The records arrive shortly.')}>Fetch the records</button>
            </div>
          </li>
        ))}
      </ul>

      <h3>Records received</h3>
      {records.length === 0 && <p className="muted">Nothing received yet. Records appear here after the patient grants consent and you fetch them.</p>}
      {records.map((rec) => (
        <details key={rec.id} className="logentry">
          <summary><strong>{rec.careContextReference}</strong> <span className="muted">· from {rec.hipId || 'a provider'} · {new Date(rec.receivedAt).toLocaleString()}</span></summary>
          <pre className="json">{JSON.stringify(rec.bundle, null, 2)}</pre>
        </details>
      ))}
    </section>
  );
}
