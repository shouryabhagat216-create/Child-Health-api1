import { api, setToken } from '../api.js';

// MOCK login for synthetic guardians. These demo passwords are public (they are in the repo)
// and exist only so the demo can show that one parent cannot see another parent's child.
const DEMO_GUARDIANS = [
  { username: 'neha.sharma', password: 'mock-password-1', label: 'Neha Sharma' },
  { username: 'rohit.verma', password: 'mock-password-2', label: 'Rohit Verma' },
];

export default function LoginPanel({ guardian, onLogin, onLogout }) {
  const login = async (g) => {
    const res = await api('POST', '/auth/mock-login', { body: { username: g.username, password: g.password } });
    if (res.ok) {
      setToken(res.data.token);
      onLogin(res.data.guardian);
    }
  };

  if (guardian) {
    return (
      <section className="card">
        <h2>Signed in</h2>
        <p>{guardian.displayName}</p>
        <button
          onClick={() => {
            setToken(null);
            onLogout();
          }}
        >
          Log out
        </button>
      </section>
    );
  }
  return (
    <section className="card">
      <h2>Mock login</h2>
      <p className="muted">Synthetic guardians only. This is not production authentication.</p>
      <div className="row">
        {DEMO_GUARDIANS.map((g) => (
          <button key={g.username} onClick={() => login(g)}>
            Log in as {g.label}
          </button>
        ))}
      </div>
    </section>
  );
}
