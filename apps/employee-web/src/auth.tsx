import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Camera, Clock3, Eye, EyeOff, LockKeyhole, MapPin } from 'lucide-react';
import { setPassword, signIn, type Employee } from './api';
import { Alert, Brand, message } from './ui';

function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="auth-layout">
      <aside className="auth-brand">
        <Brand />
        <div className="auth-story">
          <h1>
            Work in the field,
            <br />
            stay connected.
          </h1>
          <p>One place to check in, document visits, and follow your workday.</p>
          <div className="auth-tools">
            <span>
              <Clock3 /> Attendance
            </span>
            <span>
              <MapPin /> Field visits
            </span>
            <span>
              <Camera /> Visit evidence
            </span>
          </div>
        </div>
        <footer>Renuka Fire Service</footer>
      </aside>
      <section className="auth-main">
        <div className="auth-content">{children}</div>
      </section>
    </main>
  );
}
function Password({
  label = 'Password',
  name = 'password',
  newPassword = false,
}: {
  label?: string;
  name?: string;
  newPassword?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <label>
      {label}
      <span className="password-field">
        <input
          name={name}
          required
          type={visible ? 'text' : 'password'}
          autoComplete={newPassword ? 'new-password' : 'current-password'}
          minLength={newPassword ? 12 : undefined}
          maxLength={128}
          placeholder={newPassword ? 'At least 12 characters' : 'Enter your password'}
        />
        <button
          type="button"
          className="icon-button"
          aria-label={visible ? 'Hide password' : 'Show password'}
          onClick={() => setVisible((value) => !value)}
        >
          {visible ? <EyeOff size={20} /> : <Eye size={20} />}
        </button>
      </span>
    </label>
  );
}
export function SignIn({ onSignIn }: { onSignIn: (employee: Employee) => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const values = new FormData(event.currentTarget);
    const identifier = String(values.get('identifier')).trim();
    if (!identifier) {
      setError('Enter your work email or employee ID.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      onSignIn(await signIn(identifier, String(values.get('password'))));
      navigate('/', { replace: true });
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthLayout>
      <div className="auth-icon">
        <LockKeyhole />
      </div>
      <h2>Employee sign in</h2>
      <p>Use your work email or employee ID to access FieldForce.</p>
      <form className="stack" onSubmit={submit}>
        <label>
          Email or employee ID
          <input
            name="identifier"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            maxLength={254}
            placeholder="Example: EMP0001"
          />
        </label>
        <Password />
        <div className="form-links">
          <Link to="/forgot-password">Forgot password?</Link>
        </div>
        <Alert error={error} />
        <button className="button primary wide" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <div className="auth-footer">
        <Link to="/welcome">First time here?</Link>
        <Link to="/account/setup">Activate an account</Link>
      </div>
    </AuthLayout>
  );
}
export function Welcome() {
  const steps = [
    {
      icon: LockKeyhole,
      title: 'Activate your employee account',
      text: 'Open the one-time link issued by your administrator and set your password.',
    },
    {
      icon: Clock3,
      title: 'Check in for your shift',
      text: 'Use precise location when you check in or check out.',
    },
    {
      icon: Camera,
      title: 'Record a field visit',
      text: 'Add the visit details and a GPS-verified selfie, then submit it for review.',
    },
  ];
  return (
    <AuthLayout>
      <h2>Welcome to FieldForce</h2>
      <div className="onboarding">
        {steps.map(({ icon: Icon, title, text }) => (
          <article key={title}>
            <Icon size={22} />
            <div>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          </article>
        ))}
      </div>
      <Link className="button primary" to="/login">
        Continue to sign in
      </Link>
    </AuthLayout>
  );
}
export function AccountSetup() {
  const [token] = useState(() => new URLSearchParams(location.hash.slice(1)).get('token'));
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (location.hash) history.replaceState(history.state, '', location.pathname);
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || busy) return;
    const values = new FormData(event.currentTarget);
    const password = String(values.get('password'));
    if (password !== values.get('confirm')) {
      setError('Passwords must match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await setPassword(token, password);
      setDone(true);
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthLayout>
      <h2>Set your password</h2>
      {done ? (
        <p className="success" role="status">
          Password saved. You can now sign in.
        </p>
      ) : !token ? (
        <p>Open the one-time activation or password reset link issued by your administrator.</p>
      ) : (
        <form className="stack" onSubmit={submit}>
          <Password label="New password" newPassword />
          <Password label="Confirm password" name="confirm" newPassword />
          <Alert error={error} />
          <button className="button primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save password'}
          </button>
        </form>
      )}
      <Link to="/login">Back to sign in</Link>
    </AuthLayout>
  );
}
export function ForgotPassword() {
  return (
    <AuthLayout>
      <h2>Reset your password</h2>
      <p>
        Ask your Renuka administrator for a one-time password reset link. Open that link to set a
        new password.
      </p>
      <Link className="button primary" to="/login">
        Back to sign in
      </Link>
    </AuthLayout>
  );
}
