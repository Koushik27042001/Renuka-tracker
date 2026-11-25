import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BrowserRouter,
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import {
  Bell,
  ChartNoAxesColumnIncreasing,
  CircleHelp,
  Clock3,
  CloudUpload,
  House,
  LogOut,
  MapPin,
  Menu,
  Settings as SettingsIcon,
  UserRound,
  X,
} from 'lucide-react';
import { currentAttendance, onExpired, restore, signOut, type Employee } from './api';
import { AccountSetup, ForgotPassword, SignIn, Welcome } from './auth';
import {
  Attendance,
  Dashboard,
  Help,
  History,
  Notifications,
  Profile,
  Reports,
  Settings,
  Sync,
} from './pages';
import { queued, removeDraft, syncDrafts, type QueuedDraft } from './offline';
import { Alert, Brand, Loading, message, UpdatePrompt, useInstall, useResource } from './ui';
import { NewVisit, VisitCamera, VisitDetails, VisitList } from './visits';
import '@fontsource-variable/manrope';
import '@fontsource/playfair-display/latin-600.css';
import './styles.css';

const nav = [
  { to: '/', name: 'Home', icon: House },
  { to: '/visits', name: 'Visits', icon: MapPin },
  { to: '/attendance', name: 'Attendance', icon: Clock3 },
  { to: '/profile', name: 'Profile', icon: UserRound },
  { to: '/reports', name: 'Reports', icon: ChartNoAxesColumnIncreasing },
  { to: '/notifications', name: 'Notifications', icon: Bell },
  { to: '/sync', name: 'Synchronization', icon: CloudUpload },
  { to: '/settings', name: 'Settings', icon: SettingsIcon },
  { to: '/help', name: 'Help and support', icon: CircleHelp },
];

function SignedIn({ employee }: { employee: Employee }) {
  const location = useLocation();
  const shift = useResource(currentAttendance, []);
  const install = useInstall();
  const drawer = useRef<HTMLDialogElement>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [rows, setRows] = useState<QueuedDraft[]>([]);
  const [syncError, setSyncError] = useState('');
  const [busy, setBusy] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const [queueVersion, setQueueVersion] = useState(0);
  const live = useRef(true);
  const syncing = useRef(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    live.current = true;
    const connected = () => {
      setOnline(true);
      setVersion((value) => value + 1);
    };
    const disconnected = () => setOnline(false);
    window.addEventListener('online', connected);
    window.addEventListener('offline', disconnected);
    return () => {
      live.current = false;
      window.removeEventListener('online', connected);
      window.removeEventListener('offline', disconnected);
    };
  }, []);
  useEffect(() => {
    drawer.current?.close();
    window.scrollTo({ top: 0 });
    document.getElementById('main-content')?.focus({ preventScroll: true });
  }, [location.pathname]);
  useEffect(() => {
    let active = true;
    void queued(employee.id).then(
      (value) => {
        if (active) setRows(value);
      },
      (error) => {
        if (active) setSyncError(message(error));
      },
    );
    return () => {
      active = false;
    };
  }, [employee.id, queueVersion]);
  useEffect(() => {
    if (!online || !rows.some((row) => !row.failure) || syncing.current) return;
    syncing.current = true;
    setBusy(true);
    setSyncError('');
    const sync = () => syncDrafts(employee, () => live.current && navigator.onLine);
    const work = navigator.locks
      ? navigator.locks.request('renuka-draft-sync:' + employee.id, sync)
      : sync();
    void work
      .catch((error) => {
        if (live.current) setSyncError(message(error));
      })
      .finally(() => {
        syncing.current = false;
        if (live.current) {
          setBusy(false);
          void queued(employee.id).then(
            (next) => {
              if (live.current)
                setRows((previous) =>
                  JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
                );
            },
            (error) => {
              if (live.current) setSyncError(message(error));
            },
          );
        }
      });
  }, [employee, online, rows, version]);
  async function logout() {
    if (signingOut) return;
    setSigningOut(true);
    setLogoutError('');
    try {
      await signOut();
    } catch (error) {
      setLogoutError(message(error));
      setSigningOut(false);
    }
  }
  function menu() {
    return (
      <>
        <Brand />
        <div className="sidebar-user">
          <span className="avatar">{employee.fullName.trim().charAt(0).toUpperCase()}</span>
          <div>
            <strong>{employee.fullName}</strong>
            <small>{employee.employeeCode}</small>
          </div>
        </div>
        <nav aria-label="Employee navigation">
          {nav.map(({ to, name, icon: Icon }) => (
            <NavLink key={to} end={to === '/'} to={to} onClick={() => drawer.current?.close()}>
              <Icon size={19} />
              {name}
            </NavLink>
          ))}
        </nav>
        <button className="sidebar-logout" disabled={signingOut} onClick={() => void logout()}>
          <LogOut size={19} />
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </>
    );
  }
  return (
    <div className={location.pathname === '/' ? 'workspace workspace-home' : 'workspace'}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="desktop-sidebar sidebar">{menu()}</aside>
      <dialog
        ref={drawer}
        className="mobile-drawer"
        aria-label="Employee navigation"
        onClick={(event) => {
          if (event.target === event.currentTarget) drawer.current?.close();
        }}
      >
        <div className="sidebar">
          <button
            className="icon-button close-drawer"
            aria-label="Close menu"
            onClick={() => drawer.current?.close()}
          >
            <X />
          </button>
          {menu()}
          {logoutError && <Alert error={logoutError} />}
        </div>
      </dialog>
      <div className="workspace-body">
        <header className="topbar">
          <div>
            <button
              className="icon-button menu-button"
              aria-label="Open navigation"
              onClick={() => drawer.current?.showModal()}
            >
              <Menu />
            </button>
            <Brand />
          </div>
          <div className="top-actions">
            <Link className="icon-button" aria-label="Notifications" to="/notifications">
              <Bell size={21} />
            </Link>
            <Link className="top-profile" to="/profile" aria-label="Employee profile">
              <span className="avatar">{employee.fullName.trim().charAt(0).toUpperCase()}</span>
            </Link>
          </div>
        </header>
        <main className="workspace-content stack" id="main-content" tabIndex={-1}>
          {!online && (
            <div className="notice" role="status">
              You’re offline. You can save a text visit draft if your active shift is already
              loaded.
            </div>
          )}
          <Alert error={logoutError} />
          <Routes>
            <Route
              index
              element={
                <Dashboard
                  employee={employee}
                  shift={shift.data}
                  shiftError={shift.error}
                  retry={shift.refresh}
                  queuedCount={rows.length}
                />
              }
            />
            <Route path="/visits" element={<VisitList />} />
            <Route
              path="/visits/new"
              element={
                <NewVisit
                  shift={shift.data}
                  owner={employee.id}
                  queueChanged={() => setQueueVersion((value) => value + 1)}
                />
              }
            />
            <Route path="/visits/:id" element={<VisitDetails key={location.pathname} />} />
            <Route
              path="/visits/:id/camera"
              element={<VisitCamera key={location.pathname} shift={shift.data} />}
            />
            <Route
              path="/attendance"
              element={
                <Attendance shift={shift.data} error={shift.error} refresh={shift.refresh} />
              }
            />
            <Route path="/attendance/history" element={<History />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/profile" element={<Profile employee={employee} />} />
            <Route path="/settings" element={<Settings install={install} />} />
            <Route path="/help" element={<Help />} />
            <Route
              path="/sync"
              element={
                <Sync
                  rows={rows}
                  online={online}
                  busy={busy}
                  error={syncError}
                  sync={() => setVersion((value) => value + 1)}
                  discard={(key) =>
                    void removeDraft(employee.id, key).then(
                      () => setQueueVersion((value) => value + 1),
                      (error) => setSyncError(message(error)),
                    )
                  }
                />
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <nav className="bottom-nav" aria-label="Quick navigation">
          {nav.slice(0, 4).map(({ to, name, icon: Icon }) => (
            <NavLink key={to} end={to === '/'} to={to}>
              <Icon size={21} />
              {name}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}

function Session() {
  const location = useLocation();
  const [employee, setEmployee] = useState<Employee | null>();
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const unsubscribe = onExpired(() => setEmployee(null));
    void restore().then(
      (user) => {
        if (active) setEmployee(user);
      },
      (error) => {
        if (active) {
          setError(message(error));
          setEmployee(null);
        }
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  const publicRoutes = ['/login', '/welcome', '/forgot-password', '/account/setup'];
  const publicScreen = publicRoutes.includes(location.pathname);
  const safeUpdate =
    !/^\/(?:login$|account\/setup$|attendance$|visits\/(?:new|[^/]+(?:\/camera)?)$)/.test(
      location.pathname,
    );
  return (
    <>
      <UpdatePrompt canReload={safeUpdate} />
      {publicScreen ? (
        <Routes>
          <Route
            path="/login"
            element={
              employee ? (
                <Navigate to="/" replace />
              ) : (
                <SignIn
                  onSignIn={(signedIn) => {
                    setError('');
                    setEmployee(signedIn);
                  }}
                />
              )
            }
          />
          <Route path="/welcome" element={<Welcome />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/account/setup" element={<AccountSetup />} />
        </Routes>
      ) : employee === undefined ? (
        <div className="splash">
          <Brand />
          <Loading label="Opening FieldForce…" />
        </div>
      ) : employee ? (
        <SignedIn key={employee.id} employee={employee} />
      ) : error ? (
        <main className="splash">
          <Brand />
          <Alert error={error} />
          <Link className="button primary" to="/login">
            Go to sign in
          </Link>
        </main>
      ) : (
        <Navigate to="/login" replace />
      )}
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <Session />
  </BrowserRouter>,
);
