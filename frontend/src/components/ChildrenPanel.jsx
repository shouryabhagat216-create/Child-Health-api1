import { useState } from 'react';
import { api } from '../api.js';
import { STATES } from '../states.js';

const EMPTY = { name: '', dateOfBirth: '', guardianName: '', state: 'Maharashtra', consentStatus: 'granted' };

export default function ChildrenPanel({ children, selectedId, onSelect, onChanged }) {
  const [form, setForm] = useState(EMPTY);
  const [problem, setProblem] = useState(null);
  const [reminder, setReminder] = useState({ vaccineName: '', dueDate: '', reminderStatus: 'completed' });

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const register = async (e) => {
    e.preventDefault();
    const res = await api('POST', '/children', { body: form });
    if (res.ok) {
      setProblem(null);
      setForm(EMPTY);
      await onChanged(res.data.id);
    } else {
      setProblem(res.data.error);
    }
  };

  const addReminder = async (e) => {
    e.preventDefault();
    const res = await api('POST', '/reminders', { body: { childId: selectedId, ...reminder } });
    setProblem(res.ok ? null : res.data.error);
    if (res.ok) setReminder({ ...reminder, vaccineName: '', dueDate: '' });
  };

  return (
    <section className="card">
      <h2>Children</h2>
      <ul className="list">
        {children.length === 0 && <li className="muted">No children yet for this guardian.</li>}
        {children.map((c) => (
          <li key={c.id}>
            <button className={c.id === selectedId ? 'selected' : ''} onClick={() => onSelect(c.id)}>
              {c.name} · born {c.dateOfBirth} · consent {c.consentStatus}
            </button>
          </li>
        ))}
      </ul>

      <h3>Register a child (synthetic data only)</h3>
      <form onSubmit={register} className="form">
        <label>Name <input value={form.name} onChange={set('name')} /></label>
        <label>Date of birth <input type="date" value={form.dateOfBirth} onChange={set('dateOfBirth')} /></label>
        <label>Guardian name <input value={form.guardianName} onChange={set('guardianName')} /></label>
        <label>State
          <select value={form.state} onChange={set('state')}>
            {STATES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label>Consent to WombTo18 processing
          <select value={form.consentStatus} onChange={set('consentStatus')}>
            <option>granted</option><option>pending</option><option>revoked</option>
          </select>
        </label>
        <button type="submit">Register child</button>
      </form>

      {selectedId && (
        <>
          <h3>Add a vaccination reminder to the selected child</h3>
          <form onSubmit={addReminder} className="form">
            <label>Vaccine <input value={reminder.vaccineName} onChange={(e) => setReminder({ ...reminder, vaccineName: e.target.value })} /></label>
            <label>Due date <input type="date" value={reminder.dueDate} onChange={(e) => setReminder({ ...reminder, dueDate: e.target.value })} /></label>
            <label>Status
              <select value={reminder.reminderStatus} onChange={(e) => setReminder({ ...reminder, reminderStatus: e.target.value })}>
                <option>completed</option><option>scheduled</option><option>sent</option><option>cancelled</option>
              </select>
            </label>
            <button type="submit">Add reminder</button>
            <p className="muted">Only "completed" reminders are shared in the FHIR bundle.</p>
          </form>
        </>
      )}

      {problem && (
        <p className="error">
          {problem.code}: {problem.message}
          {problem.details && problem.details.map((d) => ` — ${d.field} ${d.message}`)}
        </p>
      )}
    </section>
  );
}
