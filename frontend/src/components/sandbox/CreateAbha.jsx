import { useRef, useState } from 'react';
import { api, apiBlob, describeError } from '../../api.js';
import {
  TERMS_HEADING, TERMS, DECLARATIONS_INTRO, DECLARATIONS, workerConfirmation, beneficiaryConfirmation,
} from '../../consentText.js';
import { explain, useCountdown } from './common.jsx';
import { Alert, OtpInput, ProfileCard, Spinner, Stepper } from './ui.jsx';

const MAX_RESENDS = 2;
const RESEND_WAIT = 60;
const STEPS = [['consent', 'Consent'], ['aadhaar', 'Aadhaar'], ['otp', 'OTP'], ['address', 'ABHA address'], ['done', 'Your ABHA']];
// The rules printed beside the ABHA address field. ABDM has the final say; these catch the obvious mistakes.
const ADDRESS_RULES = [
  ['8 to 18 characters including @sbx', (a) => a.length + 4 >= 8 && a.length + 4 <= 18],
  ['letters and digits only, with at most one dot and one underscore', (a) => /^[A-Za-z0-9._]+$/.test(a) && (a.match(/\./g) || []).length <= 1 && (a.match(/_/g) || []).length <= 1],
  ['starts with a letter, and does not start or end with a dot or underscore', (a) => /^[A-Za-z]/.test(a) && !/[._]$/.test(a)],
];

// Create an ABHA by Aadhaar OTP against the REAL ABDM sandbox (cases CRT_ABHA_101 to 116).
// The Aadhaar number and the OTP live only in this screen's memory while a step needs them and are never
// written anywhere. It creates the ABHA of the person whose Aadhaar is used (the parent or guardian).
export default function CreateAbha({ child, guardian }) {
  const base = `/abha/children/${child.id}`;
  const [step, setStep] = useState('consent');
  const [agreed, setAgreed] = useState(false);
  const [declared, setDeclared] = useState({});
  const [workerOk, setWorkerOk] = useState(false);
  const [beneficiaryOk, setBeneficiaryOk] = useState(false);
  const [aadhaarError, setAadhaarError] = useState(null);
  const [problem, setProblem] = useState(null);
  const [txn, setTxn] = useState(null);
  const [maskedMessage, setMaskedMessage] = useState('');
  const [resends, setResends] = useState(0);
  const [created, setCreated] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [address, setAddress] = useState('');
  const [addressTaken, setAddressTaken] = useState(false);
  const [chosen, setChosen] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [card, setCard] = useState(null);
  const [cardNote, setCardNote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [left, restartCountdown] = useCountdown();
  const aadhaarRef = useRef(''); // kept only until the OTP is verified, for a resend
  const [aadhaar, setAadhaar] = useState('');
  const [showAadhaar, setShowAadhaar] = useState(false);
  const [otp, setOtp] = useState('');
  const [mobile, setMobile] = useState('');

  const name = guardian.displayName;
  const ready = agreed && !declared.d2 && DECLARATIONS.filter((d) => d.required).every((d) => declared[d.id]) && workerOk && beneficiaryOk;

  const forgetSecrets = () => {
    aadhaarRef.current = '';
    setAadhaar('');
    setOtp('');
    setMobile('');
  };
  const startOver = () => {
    forgetSecrets();
    setStep('consent'); setAgreed(false); setDeclared({}); setWorkerOk(false); setBeneficiaryOk(false);
    setTxn(null); setResends(0); setCreated(null); setSuggestions([]); setAddress(''); setChosen(null); setProfile(null);
    setCard(null); setCardNote(null); setProblem(null); setAadhaarError(null); setAddressTaken(false);
  };

  const sendOtp = async (isResend) => {
    setProblem(null);
    const value = aadhaarRef.current;
    if (!/^\d{12}$/.test(value)) return setAadhaarError('Aadhaar Number is not valid'); // refused here: nothing is sent
    setAadhaarError(null);
    setBusy(true);
    const res = await api('POST', `${base}/create/request-otp`, { body: { aadhaar: value, consentAgreed: true, ...(isResend ? { txnId: txn } : {}) } });
    setBusy(false);
    if (!res.ok) return setProblem(explain(res));
    setTxn(res.data.txnId);
    setMaskedMessage(res.data.message); // names the masked mobile, as ABDM returned it
    if (isResend) setResends((n) => n + 1);
    restartCountdown(RESEND_WAIT);
    setStep('otp');
  };

  const verify = async () => {
    setProblem(null);
    setBusy(true);
    const res = await api('POST', `${base}/create/verify-otp`, { body: { txnId: txn, otp, mobile } });
    setBusy(false);
    if (!res.ok) {
      setOtp(''); // a wrong OTP keeps the transaction: enter it again on this screen
      return setProblem(explain(res));
    }
    forgetSecrets();
    setCreated(res.data);
    const sug = await api('GET', `${base}/create/address-suggestions?txnId=${encodeURIComponent(txn)}`);
    if (sug.ok) setSuggestions(sug.data.addresses);
    else setProblem(explain(sug));
    setStep('address');
  };

  const showProfileAndCard = async (addr) => {
    setChosen(addr);
    setStep('done');
    setLoadingProfile(true);
    const p = await api('GET', `${base}/create/profile?txnId=${encodeURIComponent(txn)}`);
    if (p.ok) setProfile(p.data.profile);
    else setProblem(explain(p));
    setLoadingProfile(false);
    const c = await apiBlob(`${base}/create/card?txnId=${encodeURIComponent(txn)}`);
    if (c.ok) setCard(c.url);
    else setCardNote(c.data?.error ? describeError(c) : 'The ABHA card is not available.');
  };

  const createAddress = async () => {
    setProblem(null);
    setAddressTaken(false);
    setBusy(true);
    const res = await api('POST', `${base}/create/address`, { body: { txnId: txn, abhaAddress: address } });
    setBusy(false);
    if (res.ok) return showProfileAndCard(res.data.abhaAddress);
    if (/already exist/i.test(describeError(res))) return setAddressTaken(true);
    setProblem(explain(res));
  };

  const addressBroken = ADDRESS_RULES.some(([, test]) => address && !test(address));
  const fullName = profile ? [profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(' ') : '';

  return (
    <section className="card">
      <div className="sectionhead">
        <h2>Create an ABHA with Aadhaar OTP</h2>
        <span className="envchip">SANDBOX</span>
      </div>
      <p className="lead">Creates the ABHA of the person whose Aadhaar number is entered (the parent or guardian), not a child ABHA. Use a test identity.</p>
      <Stepper steps={STEPS} current={step} />

      {step === 'consent' && (
        <div className="steps">
          <div className="step">
            <h3>{TERMS_HEADING}</h3>
            <div className="terms" tabIndex={0} role="region" aria-label="Terms and conditions text, scrollable"><p>{TERMS}</p></div>
            <label className="check"><input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /> <span>I Agree</span></label>
          </div>
          <div className="step">
            <p><strong>{DECLARATIONS_INTRO}</strong></p>
            {DECLARATIONS.map((d) => (
              <label key={d.id} className="check">
                <input type="checkbox" checked={Boolean(declared[d.id])} onChange={(e) => setDeclared({ ...declared, [d.id]: e.target.checked })} />
                <span>{d.text}</span>
              </label>
            ))}
            {declared.d2 && <Alert kind="warning">Creating an ABHA with a document other than Aadhaar (driving licence) is not available in this prototype. Untick it to continue with Aadhaar.</Alert>}
            <label className="check indent"><input type="checkbox" checked={workerOk} onChange={(e) => setWorkerOk(e.target.checked)} /><span>{workerConfirmation(name)}</span></label>
            <label className="check indent"><input type="checkbox" checked={beneficiaryOk} onChange={(e) => setBeneficiaryOk(e.target.checked)} /><span>{beneficiaryConfirmation(name)}</span></label>
            <p className="muted small">In this prototype the logged-in guardian is both the person using the system and the person whose Aadhaar is used, so both names are {name}. Agreement is recorded in the audit trail, with who and when, when the OTP is requested.</p>
          </div>
          <div className="actions">
            <button className="primary" disabled={!ready} onClick={() => setStep('aadhaar')}>Continue</button>
            <span className="muted small">No ABHA? Registration and care go ahead without one.</span>
          </div>
        </div>
      )}

      {step === 'aadhaar' && (
        <form className="form" onSubmit={(e) => { e.preventDefault(); sendOtp(false); }}>
          <div className="field">
            <label htmlFor="aadhaar">Aadhaar number</label>
            <div className="field-row">
              <input
                id="aadhaar" type={showAadhaar ? 'text' : 'password'} inputMode="numeric" autoComplete="off" maxLength={12} value={aadhaar}
                aria-invalid={Boolean(aadhaarError)} aria-describedby="aadhaar-hint" className={aadhaarError ? 'invalid' : ''}
                onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); setAadhaar(v); aadhaarRef.current = v; setAadhaarError(null); }}
              />
              <button type="button" onClick={() => setShowAadhaar((s) => !s)} aria-pressed={showAadhaar}>{showAadhaar ? 'Hide' : 'Show'}</button>
            </div>
            <span id="aadhaar-hint" className="hint">12 digits. Sent only to this app's server, which encrypts it for ABDM. Never stored or logged.</span>
          </div>
          {aadhaarError && <Alert kind="error">{aadhaarError}</Alert>}
          {problem && <Alert kind={problem.kind} title={problem.title}>{problem.text}</Alert>}
          <div className="actions">
            <button type="button" onClick={() => { forgetSecrets(); setStep('consent'); }}>Back</button>
            <button className="primary" type="submit" disabled={busy}>{busy ? <><Spinner /> Sending…</> : 'Send OTP'}</button>
          </div>
        </form>
      )}

      {step === 'otp' && (
        <form className="form" onSubmit={(e) => { e.preventDefault(); verify(); }}>
          <Alert kind="info" title="OTP sent">{maskedMessage}</Alert>
          <div className="field">
            <label>Enter the 6-digit OTP</label>
            <OtpInput value={otp} onChange={setOtp} disabled={busy} label="OTP" />
          </div>
          <div className="field">
            <label htmlFor="mobile">Mobile number to link with the ABHA</label>
            <input id="mobile" type="tel" inputMode="numeric" autoComplete="off" maxLength={10} value={mobile} aria-describedby="mobile-hint" onChange={(e) => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))} />
            <span id="mobile-hint" className="hint">10 digits. Use the Aadhaar-linked number: it needs no second OTP. A different number would need a second OTP, which is not built yet.</span>
          </div>
          {problem && <Alert kind={problem.kind} title={problem.title}>{problem.text}</Alert>}
          <div className="actions">
            <button className="primary" type="submit" disabled={busy || otp.length !== 6 || mobile.length !== 10}>{busy ? <><Spinner /> Checking…</> : 'Verify'}</button>
            <button type="button" disabled={busy || left > 0 || resends >= MAX_RESENDS} onClick={() => sendOtp(true)}>
              {resends >= MAX_RESENDS ? 'Resend used' : left > 0 ? `Resend OTP in ${left}s` : 'Resend OTP'}
            </button>
          </div>
          <p className="muted small" aria-live="polite">
            Resends used: {resends} of {MAX_RESENDS}.
            {resends >= MAX_RESENDS && ' Maximum OTP resend attempts reached. Please try again after 30 mins'}
          </p>
        </form>
      )}

      {step === 'address' && created && (
        <div className="steps">
          <Alert kind="success" title={created.message}>{created.isNew === false && 'This Aadhaar already had an ABHA, so we carry on with that account.'}</Alert>
          <ProfileCard
            name={[created.profile.firstName, created.profile.middleName, created.profile.lastName].filter(Boolean).join(' ')}
            abhaNumber={created.profile.abhaNumber}
            abhaAddress={(created.profile.abhaAddresses || []).join(', ')}
            status={created.profile.abhaStatus}
          />
          <h3>Choose an ABHA address</h3>
          <p className="lead">An easy-to-remember address for sharing records. Pick one, or type your own.</p>
          {suggestions.length > 0 && (
            <div className="chips" role="list" aria-label="Suggested addresses">
              {suggestions.map((s) => (
                <button key={s} role="listitem" className={address === s ? 'selected' : ''} onClick={() => { setAddress(s); setAddressTaken(false); }}>{s}</button>
              ))}
            </div>
          )}
          <div className="form">
            <div className="field">
              <label htmlFor="address">Or type your own (the @sbx ending is added)</label>
              <input id="address" value={address} autoComplete="off" className={addressBroken ? 'invalid' : ''} onChange={(e) => { setAddress(e.target.value.trim()); setAddressTaken(false); }} />
            </div>
            <ul className="rules" aria-label="Address rules">
              {ADDRESS_RULES.map(([text, test]) => (
                <li key={text} className={!address ? 'neutral' : test(address) ? 'met' : 'unmet'}>{text}</li>
              ))}
            </ul>
          </div>
          {addressTaken && (
            <Alert kind="error" title="ABHA address already exists.">
              <div className="actions">
                <button onClick={() => showProfileAndCard(`${address}@sbx`)}>Proceed with the existing address</button>
                <button onClick={() => { setAddress(''); setAddressTaken(false); }}>Create a new one</button>
              </div>
            </Alert>
          )}
          {problem && <Alert kind={problem.kind} title={problem.title}>{problem.text}</Alert>}
          <div className="actions">
            <button className="primary" disabled={busy || !address || addressBroken} onClick={createAddress}>{busy ? <><Spinner /> Creating…</> : 'Create address'}</button>
            <button onClick={() => showProfileAndCard(null)}>Keep the default address</button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="steps">
          {loadingProfile && <div className="skeleton" aria-label="Loading the profile" />}
          {!loadingProfile && profile && (
            <ProfileCard
              name={fullName}
              abhaNumber={profile.abhaNumber}
              abhaAddress={chosen || profile.abhaAddress}
              kycVerified={profile.kycVerified}
              details={[
                { label: 'Date of birth', value: profile.dob, locked: true },
                { label: 'Gender', value: profile.gender, locked: true },
                { label: 'Mobile', value: profile.mobile },
                { label: 'State', value: profile.stateName },
                { label: 'District', value: profile.districtName },
              ]}
            />
          )}
          <p className="muted small">Name, date of birth and gender come from Aadhaar and cannot be changed here.</p>
          {problem && <Alert kind={problem.kind} title={problem.title}>{problem.text}</Alert>}
          {card && (
            <div className="cardbox">
              <img className="card-image" src={card} alt="ABHA card, as returned by ABDM" />
              <a href={card} download="abha-card.png"><button type="button">Download the card</button></a>
            </div>
          )}
          {!card && profile?.kycVerified === false && <Alert kind="warning" title="No card to download">This ABHA is not KYC verified, so ABDM does not issue a card for it.</Alert>}
          {cardNote && <Alert kind="warning">{cardNote}</Alert>}
          <div className="actions"><button onClick={startOver}>Create another</button></div>
        </div>
      )}
    </section>
  );
}
