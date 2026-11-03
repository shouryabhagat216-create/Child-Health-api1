import { api, setToken } from '../api.js';

// MOCK login for synthetic guardians. These demo passwords are public (they are in the repo)
// and exist only so the demo can show that one parent cannot see another parent's child.
const DEMO_GUARDIANS = [
  { username: 'neha.sharma', password: 'mock-password-1', label: 'Neha Sharma' },
  { username: 'rohit.verma', password: 'mock-password-2', label: 'Rohit Verma' },
];

export default function LoginPanel({ onLogin }) {
  const login = async (g) => {
    const res = await api('POST', '/auth/mock-login', { body: { username: g.username, password: g.password } });
    if (res.ok) {
      setToken(res.data.token);
      onLogin(res.data.guardian);
    }
  };

  return (
    <section className="card login">
      <h2>Mock login</h2>
      <p className="muted">Demo accounts only, not production authentication.</p>
      <div className="row">
        {DEMO_GUARDIANS.map((g) => (
          <button key={g.username} className="primary" onClick={() => login(g)}>
            Log in as {g.label}
          </button>
        ))}
      </div>
    </section>
  );
}
