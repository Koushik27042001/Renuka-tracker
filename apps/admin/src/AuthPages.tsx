import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { setupAccount, signIn } from './api';
import { useSession } from './session';

export function Login() {
  const user = useSession();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (user)
    return (
      <Navigate
        to={location.state?.from?.startsWith('/employees') ? location.state.from : '/employees'}
        replace
      />
    );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setError('');
    setBusy(true);
    try {
      await signIn(String(fields.get('identifier')), String(fields.get('password')));
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <form className="panel auth-card" onSubmit={submit}>
        <span className="brand-icon">
          <ShieldCheck size={21} />
        </span>
        <h1>Admin sign in</h1>
        <label>
          Email or employee code
          <input name="identifier" autoComplete="username" required />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            maxLength={128}
            required
          />
        </label>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}

export function AccountSetup() {
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token'));
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (window.location.hash) history.replaceState(history.state, '', window.location.pathname);
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const password = String(fields.get('password'));
    if (password !== fields.get('confirm')) {
      setMessage('Passwords must match.');
      return;
    }
    if (!token) return;
    setBusy(true);
    setMessage('');
    try {
      await setupAccount(token, password);
      setSuccess(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Password setup failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <form className="panel auth-card" onSubmit={submit}>
        <span className="brand-icon">
          <ShieldCheck size={21} />
        </span>
        <h1>Set your password</h1>
        {success ? (
          <p role="status">Password set. You can now sign in to the employee app.</p>
        ) : !token ? (
          <p role="alert">Open the one-time setup link shared by your administrator.</p>
        ) : (
          <>
            <label>
              New password
              <input
                type="password"
                name="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
              />
              <small>Use at least 12 characters.</small>
            </label>
            <label>
              Confirm password
              <input
                type="password"
                name="confirm"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
              />
            </label>
            {message && (
              <p className="error-text" role="alert">
                {message}
              </p>
            )}
            <button className="primary" disabled={busy}>
              {busy ? 'Saving…' : 'Set password'}
            </button>
          </>
        )}
      </form>
    </main>
  );
}
