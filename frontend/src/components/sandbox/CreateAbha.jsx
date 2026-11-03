import { useRef, useState } from 'react';
import { api, apiBlob, describeError } from '../../api.js';
import {
  TERMS_HEADING, TERMS, DECLARATIONS_INTRO, DECLARATIONS, workerConfirmation, beneficiaryConfirmation,
} from '../../consentText.js';
import { ErrorLine, Field, ProfileRow, useCountdown } from './common.jsx';

const MAX_RESENDS = 2;
const RESEND_WAIT = 60;
// The rules printed beside the ABHA address field. ABDM has the final say; these catch the obvious mistakes.
const ADDRESS_RULES = [
  ['8 to 18 characters including @sbx', (a) => a.length + 4 >= 8 && a.length + 4 <= 18],
  ['letters and digits only, with at most one dot and one underscore', (a) => /^[A-Za-z0-9._]+$/.test(a) && (a.match(/\./g) || []).length <= 1 && (a.match(/_/g) || []).length <= 1],
  ['starts with a letter, and does not start or end with a dot or underscore', (a) => /^[A-Za-z]/.test(a) && !/[._]$/.test(a)],
];

// Create an ABHA by Aadhaar OTP against the REAL ABDM sandbox (cases CRT_ABHA_101 to 116).
// The Aadhaar number and the OTP live only in this screen's memory while a step needs them and are never
// written anywhere. Note: it creates the ABHA of the person whose Aadhaar is used (the parent or guardian).
export default function CreateAbha({ child, guardian }) {
  const base = `/abha/children/${child.id}`;
  const [step, setStep] = useState('consent'); // consent -> aadhaar -> otp -> address -> done
  const [agreed, setAgreed] = useState(false);
  const [declared, setDeclared] = useState({});
  const [workerOk, setWorkerOk] = useState(false);
  const [beneficiaryOk, setBeneficiaryOk] = useState(false);
  const [aadhaarError, setAadhaarError] = useState(null);
  const [error, setError] = useState(null);
  const [txn, setTxn] = useState(null);
  const [maskedMessage, setMaskedMessage] = useState('');
  const [resends, setResends] = useState(0);
  const [created, setCreated] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [address, setAddress] = useState('');
  const [addressTaken, setAddressTaken] = useState(false);
  const [chosen, setChosen] = useState(null);
  const [profile, setProfile] = useState(null);
  const [card, setCard] = useState(null);
  const [cardMessage, setCardMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [left, restartCountdown] = useCountdown();
  const aadhaarRef = useRef(''); // kept only until the OTP is verified, for a resend
  const [aadhaar, setAadhaar] = useState('');
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
    setCard(null); setCardMessage(null); setError(null); setAadhaarError(null); setAddressTaken(false);
  };

  const sendOtp = async (isResend) => {
    setError(null);
    const value = aadhaarRef.current;
    if (!/^\d{12}$/.test(value)) {
      setAadhaarError('Aadhaar Number is not valid'); // refused here: nothing is sent
      return;
    }
    setAadhaarError(null);
    setBusy(true);
    const res = await api('POST', `${base}/create/request-otp`, { body: { aadhaar: value, consentAgreed: true, ...(isResend ? { txnId: txn } : {}) } });
    setBusy(false);
    if (!res.ok) return setError(describeError(res));
    setTxn(res.data.txnId);
    setMaskedMessage(res.data.message); // names the masked mobile, as ABDM returned it
    if (isResend) setResends((n) => n + 1);
    restartCountdown(RESEND_WAIT);
    setStep('otp');
  };

  const verify = async () => {
    setError(null);
    setBusy(true);
    const res = await api('POST', `${base}/create/verify-otp`, { body: { txnId: txn, otp, mobile } });
    setBusy(false);
    if (!res.ok) {
      setOtp(''); // a wrong OTP keeps the transaction: enter it again on this screen
      return setError(describeError(res));
    }
    forgetSecrets();
    setCreated(res.data);
    const sug = await api('GET', `${base}/create/address-suggestions?txnId=${encodeURIComponent(txn)}`);
    if (sug.ok) setSuggestions(sug.data.addresses);
    else setError(describeError(sug));
    setStep('address');
  };

  const showProfileAndCard = async (addr) => {
    setChosen(addr);
    setStep('done');
    const p = await api('GET', `${base}/create/profile?txnId=${encodeURIComponent(txn)}`);
    if (p.ok) setProfile(p.data.profile);
    else setError(describeError(p));
    const c = await apiBlob(`${base}/create/card?txnId=${encodeURIComponent(txn)}`);
    if (c.ok) setCard(c.url);
    else setCardMessage(c.data && c.data.error ? describeError(c) : 'The ABHA card is not available.');
  };

  const createAddress = async () => {
    setError(null);
    setAddressTaken(false);
    setBusy(true);
    const res = await api('POST', `${base}/create/address`, { body: { txnId: txn, abhaAddress: address } });
    setBusy(false);
    if (res.ok) return showProfileAndCard(res.data.abhaAddress);
    const text = describeError(res);
    if (/already exist/i.test(text)) return setAddressTaken(true);
    setError(text);
  };

  const failed = [...ADDRESS_RULES].some(([, test]) => address && !test(address));

  return (
    <section className="card">
      <h2>Create an ABHA with Aadhaar OTP</h2>
      <p className="notice">REAL ABDM SANDBOX. This creates the ABHA of the person whose Aadhaar number is entered (the parent or guardian), not a child ABHA. Use a test identity.</p>
      <ol className="progress" aria-label="progress">
        {[['consent', 'Consent'], ['aadhaar', 'Aadhaar'], ['otp', 'OTP'], ['address', 'ABHA address'], ['done', 'ABHA']].map(([id, label]) => (
          <li key={id} className={step === id ? 'now' : ''}>{label}</li>
        ))}
      </ol>

      {step === 'consent' && (
        <div className="steps">
          <div className="step" tabIndex={0} aria-label="Terms and conditions">
            <h3>{TERMS_HEADING}</h3>
            <p className="terms">{TERMS}</p>
            <label className="check"><input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /> I Agree</label>
          </div>
          <div className="step">
            <p><strong>{DECLARATIONS_INTRO}</strong></p>
            {DECLARATIONS.map((d) => (
              <label key={d.id} className="check">
                <input type="checkbox" checked={Boolean(declared[d.id])} onChange={(e) => setDeclared({ ...declared, [d.id]: e.target.checked })} />
                <span>{d.text}</span>
              </label>
            ))}
            {declared.d2 && <p className="error">Creating an ABHA with a document other than Aadhaar (driving licence) is not available in this prototype. Untick it to continue with Aadhaar.</p>}
            <label className="check indent"><input type="checkbox" checked={workerOk} onChange={(e) => setWorkerOk(e.target.checked)} /><span>{workerConfirmation(name)}</span></label>
            <label className="check indent"><input type="checkbox" checked={beneficiaryOk} onChange={(e) => setBeneficiaryOk(e.target.checked)} /><span>{beneficiaryConfirmation(name)}</span></label>
            <p className="muted small">In this prototype the logged-in guardian is both the person using the system and the person whose Aadhaar is used, so both names are {name}. Agreement is recorded in the audit trail with who and when when the OTP is requested.</p>
          </div>
          <div className="row">
            <button className="primary" disabled={!ready} onClick={() => setStep('aadhaar')}>Continue</button>
            <span className="muted small">Not now? Registration and care do not need an ABHA. Just close this screen.</span>
          </div>
        </div>
      )}

      {step === 'aadhaar' && (
        <form className="form" onSubmit={(e) => { e.preventDefault(); sendOtp(false); }}>
          <Field label="Aadhaar number (12 digits)" hint="Shown hidden. Sent only to this app's server, which encrypts it for ABDM. Never stored or logged.">
            <input
              type="password" inputMode="numeric" autoComplete="off" maxLength={12} value={aadhaar} aria-invalid={Boolean(aadhaarError)}
              onChange={(e) => { const v = e.target.value; setAadhaar(v); aadhaarRef.current = v; setAadhaarError(null); }}
            />
          </Field>
          <ErrorLine text={aadhaarError} />
          <ErrorLine text={error} />
          <div className="row">
            <button type="button" onClick={() => { forgetSecrets(); setStep('consent'); }}>Back</button>
            <button className="primary" type="submit" disabled={busy}>Send OTP</button>
          </div>
        </form>
      )}

      {step === 'otp' && (
        <form className="form" onSubmit={(e) => { e.preventDefault(); verify(); }}>
          <p>{maskedMessage}</p>
          <Field label="OTP (6 digits)">
            <input
              type="password" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </Field>
          <Field label="Mobile number to link with the ABHA (10 digits)" hint="Use the Aadhaar-linked number: it needs no second OTP. A different number would need a second OTP, which is not built yet.">
            <input type="tel" inputMode="numeric" autoComplete="off" maxLength={10} value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))} />
          </Field>
          <ErrorLine text={error} />
          <div className="row">
            <button className="primary" type="submit" disabled={busy || otp.length !== 6 || mobile.length !== 10}>Verify</button>
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
          <p className="ok">{created.message}{created.isNew === false && ' (this Aadhaar already had an ABHA: carrying on with that account)'}</p>
          <table><tbody>
            <ProfileRow label="ABHA number" value={created.profile.abhaNumber} />
            <ProfileRow label="Default ABHA address" value={(created.profile.abhaAddresses || []).join(', ')} />
          </tbody></table>
          <h3>Choose an ABHA address</h3>
          {suggestions.length > 0 && (
            <div className="chips" role="list">
              {suggestions.map((s) => (
                <button key={s} role="listitem" className={address === s ? 'selected' : ''} onClick={() => { setAddress(s); setAddressTaken(false); }}>{s}</button>
              ))}
            </div>
          )}
          <Field label="Or type your own (the @sbx suffix is added)">
            <input value={address} autoComplete="off" onChange={(e) => { setAddress(e.target.value.trim()); setAddressTaken(false); }} />
          </Field>
          <ul className="rules" aria-label="Address rules">
            {ADDRESS_RULES.map(([text, test]) => (
              <li key={text} className={!address ? 'neutral' : test(address) ? 'met' : 'unmet'}>{text}</li>
            ))}
          </ul>
          {addressTaken && (
            <div className="step" role="alert">
              <p className="error">ABHA address already exists.</p>
              <div className="row">
                <button onClick={() => showProfileAndCard(`${address}@sbx`)}>Proceed with the existing address</button>
                <button onClick={() => { setAddress(''); setAddressTaken(false); }}>Create a new one</button>
              </div>
            </div>
          )}
          <ErrorLine text={error} />
          <div className="row">
            <button className="primary" disabled={busy || !address || failed} onClick={createAddress}>Create address</button>
            <button onClick={() => showProfileAndCard(null)}>Keep the default address</button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="steps">
          <h3>Your ABHA</h3>
          {profile ? (
            <table><tbody>
              <ProfileRow label="ABHA number" value={profile.abhaNumber} />
              <ProfileRow label="ABHA address" value={chosen || profile.abhaAddress} />
              <ProfileRow label="Name" value={[profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(' ')} />
              <ProfileRow label="Date of birth" value={profile.dob} />
              <ProfileRow label="Gender" value={profile.gender} />
              <ProfileRow label="Mobile" value={profile.mobile} source="the communication mobile (masked)" />
              <ProfileRow label="State" value={profile.stateName} />
              <ProfileRow label="District" value={profile.districtName} />
            </tbody></table>
          ) : <p className="muted">Loading the profile...</p>}
          <p className="muted small">Name, date of birth and gender come from Aadhaar and are read only.</p>
          {profile && profile.kycVerified === false && <p className="error">This ABHA is not KYC verified, so its card cannot be downloaded.</p>}
          {card && (
            <>
              <img className="card-image" src={card} alt="ABHA card, as returned by ABDM" />
              <p><a href={card} download="abha-card.png"><button>Download the card</button></a></p>
            </>
          )}
          <ErrorLine text={cardMessage} />
          <ErrorLine text={error} />
          <button onClick={startOver}>Start another</button>
        </div>
      )}
    </section>
  );
}
