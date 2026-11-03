import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

const today = () => new Date().toISOString().slice(0, 10);

export default function AbdmPanel({ child, scenario }) {
  const [abha, setAbha] = useState(null);
  const [careContexts, setCareContexts] = useState([]);
  const [consents, setConsents] = useState([]);
  const [audit, setAudit] = useState([]);
  const [bundle, setBundle] = useState(null);
  const [txn, setTxn] = useState(null);
  const [message, setMessage] = useState(null);
  const [consentForm, setConsentForm] = useState({ purpose: 'CAREMGT', dateFrom: '2024-01-01', dateTo: today() });

  const base = `/abdm/children/${child.id}`;

  const refresh = useCallback(async () => {
    const [a, c, k, au] = await Promise.all([
      api('GET', `${base}/abha`),
      api('GET', `${base}/care-contexts`),
      api('GET', `${base}/consents`),
      api('GET', `${base}/audit`),
    ]);
    setAbha(a.ok ? a.data.abha : null);
    setCareContexts(c.ok ? c.data.careContexts : []);
    setConsents(k.ok ? k.data.consents : []);
    setAudit(au.ok ? au.data.events : []);
  }, [base]);

  useEffect(() => {
    setBundle(null);
    setTxn(null);
    setMessage(null);
    refresh();
  }, [child.id, refresh]);

  // Runs one API call with the chosen mock scenario, shows success/error, then reloads the data.
  const act = async (method, path, body) => {
    const res = await api(method, path, { body, scenario });
    setMessage(res.ok ? { ok: true, text: `OK (${res.status})` } : { ok: false, text: `${res.data.error.code}: ${res.data.error.message}` });
    await refresh();
    return res;
  };

  const verifyAbha = async () => {
    const sample = await api('GET', `${base}/abha/sample`);
    if (sample.ok) await act('POST', `${base}/abha/verify`, { abhaNumber: sample.data.abhaNumber, otp: sample.data.mockOtp });
  };

  const linkInit = async () => {
    const res = await act('POST', `${base}/care-contexts/link-init`);
    if (res.ok) setTxn(res.data.transactionId);
  };

  const linkConfirm = () => act('POST', `${base}/care-contexts/link-confirm`, { transactionId: txn, otp: '123456' });

  const requestConsent = (e) => {
    e.preventDefault();
    return act('POST', `${base}/consents`, { ...consentForm, hiTypes: ['ImmunizationRecord'] });
  };

  const fetchInfo = async (consentId) => {
    const res = await act('POST', `/abdm/consents/${consentId}/health-information`);
    setBundle(res.ok ? res.data.bundle : null);
  };

  return (
    <section className="card wide">
      <h2>ABDM simulation for {child.name}</h2>
      <p className="muted">
        Scenario for the next action: <strong>{scenario}</strong> (change it in the header). Everything below is a
        local mock; no real ABDM system is contacted.
      </p>
      {message && <p className={message.ok ? 'ok' : 'error'}>{message.text}</p>}

      <h3>1. ABHA (M1)</h3>
      <p>{abha ? <>Verified: <code>{abha.abhaNumberMasked}</code> · {abha.abhaAddress}</> : 'Not verified yet.'}</p>
      <button onClick={verifyAbha}>Verify synthetic ABHA</button>

      <h3>2. Care-context linking (M2)</h3>
      <p>{careContexts.length ? careContexts.map((c) => c.display).join(', ') : 'Nothing linked yet.'}</p>
      <div className="row">
        <button onClick={linkInit}>Link: init</button>
        <button onClick={linkConfirm} disabled={!txn}>Link: confirm with mock OTP</button>
      </div>

      <h3>3. Consent (a simulated requester asks the guardian)</h3>
      <form onSubmit={requestConsent} className="form">
        <label>Purpose
          <select value={consentForm.purpose} onChange={(e) => setConsentForm({ ...consentForm, purpose: e.target.value })}>
            <option>CAREMGT</option><option>PUBHLTH</option><option>HPAYMT</option>
          </select>
        </label>
        <label>Data from <input type="date" value={consentForm.dateFrom} onChange={(e) => setConsentForm({ ...consentForm, dateFrom: e.target.value })} /></label>
        <label>Data to <input type="date" value={consentForm.dateTo} onChange={(e) => setConsentForm({ ...consentForm, dateTo: e.target.value })} /></label>
        <button type="submit">Request consent</button>
      </form>
      <ul className="list">
        {consents.map((c) => (
          <li key={c.id} className="consent">
            <span className={`badge ${c.status === 'GRANTED' ? 'good' : c.status === 'REQUESTED' ? 'warn' : 'bad'}`}>{c.status}</span>{' '}
            {c.purpose} · {c.dateFrom} to {c.dateTo} · expires {c.expiresAt.slice(0, 10)}
            <div className="row">
              <button onClick={() => act('POST', `/abdm/consents/${c.id}/approve`)}>Approve</button>
              <button onClick={() => act('POST', `/abdm/consents/${c.id}/deny`)}>Deny</button>
              <button onClick={() => act('POST', `/abdm/consents/${c.id}/revoke`)}>Revoke</button>
              <button onClick={() => fetchInfo(c.id)}>Fetch health information</button>
            </div>
          </li>
        ))}
      </ul>

      <h3>4. FHIR bundle (synthetic, core R4 shape, not validated against ABDM profiles)</h3>
      {bundle ? <pre className="json">{JSON.stringify(bundle, null, 2)}</pre> : <p className="muted">Fetch health information with a granted consent to see it.</p>}

      <h3>5. Audit trail (your actions on this child)</h3>
      {audit.length === 0 ? <p className="muted">No events yet.</p> : (
        <table>
          <thead><tr><th>Time</th><th>Event</th><th>Outcome</th><th>Reason</th></tr></thead>
          <tbody>
            {audit.map((e) => (
              <tr key={e.id}>
                <td>{e.createdAt.replace('T', ' ').slice(0, 19)}</td>
                <td>{e.eventType}</td>
                <td><span className={`badge ${e.outcome === 'SUCCESS' ? 'good' : e.outcome === 'DENIED' ? 'warn' : 'bad'}`}>{e.outcome}</span></td>
                <td>{e.reasonCode || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
