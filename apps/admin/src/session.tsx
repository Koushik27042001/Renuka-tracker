import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Navigate, useLocation } from 'react-router-dom';
import { ApiError, restoreSession, subscribeSession } from './api';

type User = Awaited<ReturnType<typeof restoreSession>>['user'];
const Session = createContext<User | null>(null);
export const useSession = () => useContext(Session);
export function SessionProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeSession((next) => {
      setUser(next);
      if (!next) client.clear();
    });
    return unsubscribe;
  }, [client]);

  function restore() {
    setLoading(true);
    setError(false);
    void restoreSession()
      .catch((problem: unknown) => {
        if (!(problem instanceof ApiError && problem.status === 401)) setError(true);
      })
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    restore();
  }, []);

  return (
    <Session.Provider value={user}>
      {loading ? (
        <main className="auth-page">
          <p role="status">Checking your session…</p>
        </main>
      ) : error ? (
        <main className="auth-page">
          <div className="panel auth-card">
            <h1>Can’t reach the API</h1>
            <button className="primary" onClick={restore}>
              Retry
            </button>
          </div>
        </main>
      ) : (
        children
      )}
    </Session.Provider>
  );
}
export function Protected({ children }: { children: ReactNode }) {
  const user = useSession();
  const location = useLocation();
  return user ? children : <Navigate replace to="/login" state={{ from: location.pathname }} />;
}
