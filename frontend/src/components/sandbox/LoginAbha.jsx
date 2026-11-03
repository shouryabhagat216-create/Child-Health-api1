import { useState } from 'react';
import { api, apiBlob, describeError } from '../../api.js';
import { Alert, ChoiceCards, OtpInput, ProfileCard, Spinner, Stepper, groupAbha } from './ui.jsx';
import { explain, useCountdown } from './common.jsx';

const STEPS = [['identify', 'Identify'], ['verify', 'Verify'], ['abha', 'Your ABHA']];
const METHODS = [
  { value: 'aadhaar', title: 'The phone linked to Aadhaar', detail: 'UIDAI sends the OTP to the mobile number registered with the Aadhaar.' },
  { value: 'mobile', title: 'The phone linked to the ABHA', detail: 'ABDM sends the OTP to the mobile number saved on the ABHA account.' },
];
const RESEND_WAIT = 60;
const MAX_NEW_CODES = 2;

// Log in with an ABHA number (cases VRFY_ABHA_101 and 201) against the REAL ABDM sandbox.
// Identifier first, then where the OTP goes. Only ABDM-1114 means nobody holds this ABHA, so creating an ABHA is
// offered on that answer alone. The ABHA number and OTP live only in this screen's memory and are cleared after use.
export default function LoginAbha({ child, goTo }) {
  const base = `/abha/children/${child.id}`;
  const [step, setStep] = useState('identify');
  const [method, setMethod] = useState('aadhaar');
  const [abha, setAbha] = useState('');
  const [show, setShow] = useState(false);
  const [otp, setOtp] = useState('');
  const [txn, setTxn] = useState(null);
  const [message, setMessage] = useState('');
  const [newCodes, setNewCodes] = useState(0);
  const [accounts, setAccounts] = useState([]);
  const [profile, setProfile] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [card, setCard] = useState(null);
  const [cardNote, setCardNote] = useState(null);
  const [problem, setProblem] = useState(null); // { kind, title, text }
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [left, restart] = useCountdown();

  const digits = abha.replace(/\D/g, '');
  const valid = digits.length === 14;
  // When shown, a full number appears grouped (91-1234-5678-9012); while typing it stays as typed digits.
  const shown = digits.length === 14 ? groupAbha(digits) : digits;

  const requestOtp = async (isNewCode) => {
    setProblem(null);
    setNotFound(false);
    setBusy(true);
    const res = await api('POST', `${base}/login/request-otp`, { body: { abhaNumber: digits, method } });
    setBusy(false);
    if (!res.ok) {
      const code = res.data?.error?.details?.abdmCode;
      setNotFound(String(code || '').startsWith('ABDM-1114'));
      return setProblem(explain(res));
    }
    setTxn(res.data.txnId);
    setMessage(res.data.message); // where the OTP went, as ABDM said it
    setOtp('');
    if (isNewCode) setNewCodes((n) => n + 1);
    restart(RESEND_WAIT);
    setStep('verify');
  };

  const verify = async () => {
    setProblem(null);
    setBusy(true);
    const res = await api('POST', `${base}/login/verify-otp`, { body: { txnId: txn, otp } });
    setBusy(false);
    setOtp('');
    if (!res.ok) return setProblem(explain(res)); // the transaction is kept: enter the OTP again
    setAccounts(res.data.accounts || []);
    setAbha('');
    setStep('abha');
    setLoadingProfile(true);
    const p = await api('GET', `${base}/login/profile?txnId=${encodeURIComponent(txn)}`);
    if (p.ok) setProfile(p.data.profile);
    else setProblem(explain(p));
    setLoadingProfile(false);
    const c = await apiBlob(`${base}/login/card?txnId=${encodeURIComponent(txn)}`);
    if (c.ok) setCard(c.url);
    else setCardNote(c.data?.error ? describeError(c) : null);
  };

  const reset = () => {
    setStep('identify'); setAbha(''); setOtp(''); setTxn(null); setProfile(null); setCard(null); setAccounts([]);
    setProblem(null); setNotFound(false); setCardNote(null); setNewCodes(0);
  };

  const fullName = profile ? [profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(' ') : '';
  const first = accounts[0];

  return (
    <section className="card">
      <div className="sectionhead">
        <h2>Log in with an ABHA number</h2>
        <span className="envchip">SANDBOX</span>
      </div>
      <p className="lead">Find a patient's ABHA and fill their details from it, instead of typing them. Use a test identity.</p>
      <Stepper steps={STEPS} current={step === 'identify' ? 'identify' : step === 'verify' ? 'verify' : 'abha'} />

      {step === 'identify' && (
        <form className="form" onSubmit={(e) => { e.preventDefault(); if (valid) requestOtp(false); }}>
          <div className="field">
            <label htmlFor="abha-number">ABHA number</label>
            <div className="field-row">
              <input
                id="abha-number" type={show ? 'text' : 'password'} inputMode="numeric" autoComplete="off" maxLength={17}
                placeholder="14 digits" aria-describedby="abha-hint" aria-invalid={digits.length > 0 && !valid}
                className={digits.length > 0 && !valid ? 'invalid' : ''}
                value={show ? shown : abha} onChange={(e) => setAbha(e.target.value)}
              />
              <button type="button" onClick={() => setShow((s) => !s)} aria-pressed={show}>{show ? 'Hide' : 'Show'}</button>
            </div>
            <span id="abha-hint" className="hint">
              Dashes and spaces are fine. <span className="count">{Math.min(digits.length, 14)}/14 digits</span>
              {digits.length > 14 && ' – an ABHA number has exactly 14 digits'}
            </span>
          </div>

          <ChoiceCards legend="Send the OTP to" name="method" value={method} onChange={setMethod} options={METHODS} />

          {problem && <Alert kind={problem.kind} title={problem.title}>{problem.text}</Alert>}
          {notFound && (
            <Alert kind="info" title="No ABHA found for this number">
              ABDM says nobody holds this ABHA number. Check the digits, and that it is a sandbox ABHA (not a production one).
              If this person has no ABHA, you can create one.
              <div className="actions"><button type="button" onClick={() => goTo && goTo('create')}>Create an ABHA instead</button></div>
            </Alert>
          )}

          <div className="actions">
            <button className="primary" type="submit" disabled={busy || !valid}>{busy ? <><Spinner /> Sending…</> : 'Send OTP'}</button>
          </div>
        </form>
      )}

      {step === 'verify' && (
        <form className="form" onSubmit={(e) => { e.preventDefault(); if (otp.length === 6) verify(); }}>
          <Alert kind="info" title="OTP sent">{message}</Alert>
          <div className="field">
            <label id="otp-label">Enter the 6-digit OTP</label>
            <OtpInput value={otp} onChange={setOtp} disabled={busy} label="OTP" />
          </div>
          {problem && <Alert kind={problem.kind} title={problem.title}>{problem.text}</Alert>}
          <div className="actions">
            <button className="primary" type="submit" disabled={busy || otp.length !== 6}>{busy ? <><Spinner /> Checking…</> : 'Verify'}</button>
            <button type="button" disabled={busy || left > 0 || newCodes >= MAX_NEW_CODES} onClick={() => requestOtp(true)}>
              {newCodes >= MAX_NEW_CODES ? 'No more new codes' : left > 0 ? `New OTP in ${left}s` : 'Send a new OTP'}
            </button>
            <span className="grow" />
            <button type="button" className="link" onClick={reset}>Change the number</button>
          </div>
          <p className="hint muted small" aria-live="polite">A wrong OTP keeps this request open: enter it again. Asking for a new OTP starts a fresh request.</p>
        </form>
      )}

      {step === 'abha' && (
        <div>
          <Alert kind="success" title="Signed in with ABDM">The OTP was accepted.</Alert>
          {accounts.length > 1 && (
            <>
              <h3>{accounts.length} accounts found</h3>
              <div className="accounts">
                {accounts.map((a) => (
                  <div className="account" key={a.abhaNumber}><strong>{a.name}</strong><code>{groupAbha(a.abhaNumber)}</code><span className="muted">{a.abhaAddress}</span></div>
                ))}
              </div>
            </>
          )}
          {loadingProfile && <div className="skeleton" aria-label="Loading the profile" />}
          {!loadingProfile && (
            <ProfileCard
              name={fullName || first?.name}
              abhaNumber={profile?.abhaNumber || first?.abhaNumber}
              abhaAddress={profile?.abhaAddress || first?.abhaAddress}
              status={first?.status}
              kycVerified={profile?.kycVerified}
              details={profile ? [
                { label: 'Date of birth', value: profile.dob, locked: true },
                { label: 'Gender', value: profile.gender, locked: true },
                { label: 'Mobile', value: profile.mobile },
                { label: 'State', value: profile.stateName },
                { label: 'District', value: profile.districtName },
              ] : []}
            />
          )}
          <p className="muted small">Name, date of birth and gender come from Aadhaar and cannot be changed here. A correction to a form changes this app's record, never the ABHA profile.</p>
          {problem && <Alert kind={problem.kind} title={problem.title}>{problem.text}</Alert>}
          {card && (
            <div className="cardbox">
              <img className="card-image" src={card} alt="ABHA card, as returned by ABDM" />
              <a href={card} download="abha-card.png"><button type="button">Download the card</button></a>
            </div>
          )}
          {!card && profile?.kycVerified === false && <Alert kind="warning" title="No card to download">This ABHA is not KYC verified, so ABDM does not issue a card for it.</Alert>}
          {cardNote && <Alert kind="warning">{cardNote}</Alert>}
          <div className="actions"><button onClick={reset}>Log in with another ABHA</button></div>
        </div>
      )}
    </section>
  );
}
