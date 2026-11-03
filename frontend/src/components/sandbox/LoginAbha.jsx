import { useState } from 'react';
import { api, apiBlob, describeError } from '../../api.js';
import { ErrorLine, Field, ProfileRow } from './common.jsx';

// Log in with an ABHA number (cases VRFY_ABHA_101 and 201) against the REAL ABDM sandbox.
// Identifier first (the ABHA number), then how the OTP is delivered. The profile that comes back is shown with
// name, date of birth and gender read only. Only ABDM-1114 means nobody holds this ABHA: nothing is offered to
// create one on any other refusal.
export default function LoginAbha({ child }) {
  const base = `/abha/children/${child.id}`;
  const [step, setStep] = useState('start'); // start -> otp -> done
  const [method, setMethod] = useState('aadhaar');
  const [abha, setAbha] = useState('');
  const [otp, setOtp] = useState('');
  const [txn, setTxn] = useState(null);
  const [message, setMessage] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [profile, setProfile] = useState(null);
  const [card, setCard] = useState(null);
  const [cardMessage, setCardMessage] = useState(null);
  const [error, setError] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);

  const digits = abha.replace(/\D/g, '');

  const requestOtp = async () => {
    setError(null);
    setNotFound(false);
    setBusy(true);
    const res = await api('POST', `${base}/login/request-otp`, { body: { abhaNumber: digits, method } });
    setBusy(false);
    if (!res.ok) {
      const code = res.data && res.data.error && res.data.error.details && res.data.error.details.abdmCode;
      setNotFound(String(code || '').startsWith('ABDM-1114'));
      return setError(describeError(res));
    }
    setTxn(res.data.txnId);
    setMessage(res.data.message);
    setStep('otp');
  };

  const verify = async () => {
    setError(null);
    setBusy(true);
    const res = await api('POST', `${base}/login/verify-otp`, { body: { txnId: txn, otp } });
    setBusy(false);
    setOtp('');
    if (!res.ok) return setError(describeError(res)); // the transaction is kept: enter the OTP again
    setAccounts(res.data.accounts);
    setAbha('');
    setStep('done');
    const p = await api('GET', `${base}/login/profile?txnId=${encodeURIComponent(txn)}`);
    if (p.ok) setProfile(p.data.profile);
    const c = await apiBlob(`${base}/login/card?txnId=${encodeURIComponent(txn)}`);
    if (c.ok) setCard(c.url);
    else setCardMessage(c.data && c.data.error ? describeError(c) : null);
  };

  const reset = () => { setStep('start'); setAbha(''); setOtp(''); setTxn(null); setProfile(null); setCard(null); setAccounts([]); setError(null); setCardMessage(null); };

  return (
    <section className="card">
      <h2>Log in with an ABHA number</h2>
      <p className="notice">REAL ABDM SANDBOX. Use a test identity.</p>

      {step === 'start' && (
        <form className="form" onSubmit={(e) => { e.preventDefault(); requestOtp(); }}>
          <Field label="ABHA number (14 digits, dashes optional)">
            <input type="password" autoComplete="off" inputMode="numeric" maxLength={17} value={abha} onChange={(e) => setAbha(e.target.value)} />
          </Field>
          <fieldset>
            <legend>Send the OTP to</legend>
            <label className="check"><input type="radio" name="method" checked={method === 'aadhaar'} onChange={() => setMethod('aadhaar')} /> the phone linked to Aadhaar</label>
            <label className="check"><input type="radio" name="method" checked={method === 'mobile'} onChange={() => setMethod('mobile')} /> the phone linked to the ABHA</label>
          </fieldset>
          <ErrorLine text={digits.length > 0 && digits.length !== 14 ? 'An ABHA number has 14 digits' : null} />
          <ErrorLine text={error} />
          {notFound && <p className="muted">ABDM reports that nobody holds this ABHA number. Check the digits, and that it is a sandbox ABHA.</p>}
          <button className="primary" type="submit" disabled={busy || digits.length !== 14}>Send OTP</button>
        </form>
      )}

      {step === 'otp' && (
        <form className="form" onSubmit={(e) => { e.preventDefault(); verify(); }}>
          <p>{message}</p>
          <Field label="OTP (6 digits)">
            <input type="password" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} />
          </Field>
          <ErrorLine text={error} />
          <div className="row">
            <button className="primary" type="submit" disabled={busy || otp.length !== 6}>Verify</button>
            <button type="button" onClick={reset}>Start again</button>
          </div>
        </form>
      )}

      {step === 'done' && (
        <div className="steps">
          <p className="ok">OTP verified.</p>
          {accounts.length > 1 && <p className="muted">This login returned {accounts.length} accounts; each is listed below.</p>}
          {accounts.map((a) => (
            <div className="step" key={a.abhaNumber}>
              <table><tbody>
                <ProfileRow label="ABHA number" value={a.abhaNumber} />
                <ProfileRow label="ABHA address" value={a.abhaAddress} />
                <ProfileRow label="Name" value={a.name} />
                <ProfileRow label="Status" value={a.status} />
              </tbody></table>
            </div>
          ))}
          {profile && (
            <table><tbody>
              <ProfileRow label="Name" value={[profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(' ')} />
              <ProfileRow label="Date of birth" value={profile.dob} />
              <ProfileRow label="Gender" value={profile.gender} />
              <ProfileRow label="Mobile" value={profile.mobile} source="masked" />
              <ProfileRow label="State" value={profile.stateName} />
              <ProfileRow label="District" value={profile.districtName} />
            </tbody></table>
          )}
          <p className="muted small">Name, date of birth and gender are read only. Corrections to this form change this app's record, never the ABHA profile.</p>
          {profile && profile.kycVerified === false && <p className="error">This ABHA is not KYC verified, so its card cannot be downloaded.</p>}
          {card && <><img className="card-image" src={card} alt="ABHA card, as returned by ABDM" /><p><a href={card} download="abha-card.png"><button>Download the card</button></a></p></>}
          <ErrorLine text={cardMessage} />
          <button onClick={reset}>Log in again</button>
        </div>
      )}
    </section>
  );
}
