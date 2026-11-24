import { lazy, Suspense, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Link, NavLink, Outlet, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import {
  BriefcaseBusiness,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Settings,
  ShieldCheck,
  Users,
  ChartNoAxesColumn,
} from 'lucide-react';
import { fetchHealth } from '@renuka/shared';
import { apiUrl, signOut } from './api';
import { AccountSetup, Login } from './AuthPages';
import { EmployeeForm, EditEmployee } from './EmployeeForm';
import { EmployeeProfile } from './EmployeeProfile';
import { EmployeesPage, initials } from './EmployeesPage';
import { Protected, SessionProvider, useSession } from './session';
import { AttendancePage, AttendanceDetails } from './AttendancePage';

import './styles.css';
const FieldVisitDetails = lazy(() =>
  import('./FieldVisitsPage').then((module) => ({ default: module.FieldVisitDetails })),
);
const FieldVisitsPage = lazy(() =>
  import('./FieldVisitsPage').then((module) => ({ default: module.FieldVisitsPage })),
);
const AnalyticsDashboard = lazy(() =>
  import('./AnalyticsDashboard').then((module) => ({ default: module.AnalyticsDashboard })),
);
const RecordedLocations = lazy(() =>
  import('./AnalyticsDashboard').then((module) => ({ default: module.RecordedLocations })),
);

const client = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 15000, refetchOnWindowFocus: false } },
});
const nav = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/employees', label: 'Employees', icon: Users },
  { path: '/attendance', label: 'Attendance', icon: ClipboardList },
  { path: '/visits', label: 'Field Visits', icon: BriefcaseBusiness },
  { path: '/reports', label: 'Reports', icon: ChartNoAxesColumn },
  { path: '/settings', label: 'Settings', icon: Settings },
];

function Layout() {
  const user = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function leave() {
    setBusy(true);
    setError('');
    try {
      await signOut();
    } catch {
      setError('Could not sign out. Try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link to="/" className="brand">
          <span className="brand-icon">
            <ShieldCheck size={21} />
          </span>
          <span>
            Renuka Tracker<small>Admin workspace</small>
          </span>
        </Link>
        <nav aria-label="Main navigation">
          {nav.map(({ path, label, icon: Icon }) => (
            <NavLink key={path} to={path} end={path === '/'}>
              <Icon size={19} /> <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span className="workspace-label">Admin workspace</span>
          <div className="topbar-user">
            <span className="avatar">{initials(user?.fullName ?? '')}</span>
            <span className="user-name">{user?.fullName}</span>
            <button
              type="button"
              className="secondary icon-button"
              title="Sign out"
              aria-label="Sign out"
              disabled={busy}
              onClick={() => void leave()}
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>
        <main className="page">
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
function Overview() {
  const user = useSession();
  const configuration = useQuery({
    queryKey: ['organization-settings'],
    queryFn: async ({ signal }) => {
      const response = await fetch(apiUrl + '/api/v1/app/version?platform=android&version=1.0.0', {
        signal,
      });
      if (!response.ok) throw new Error('Could not load organization settings.');
      return (await response.json()).data as {
        timezone: string;
        supportEmail?: string;
        latestVersion?: string;
      };
    },
  });
  const health = useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => fetchHealth(apiUrl, signal),
  });
  return (
    <>
      <header className="page-heading">
        <div>
          <h1>Settings</h1>
        </div>
        <Link to="/employees" className="primary">
          Manage employees
        </Link>
      </header>
      <section className="panel profile-panel">
        <h2>Account</h2>
        <p>{user?.fullName}</p>
        <p>{user?.role === 'SUPER_ADMIN' ? 'Super administrator' : 'Administrator'}</p>
        {user?.department && <p>{user.department}</p>}
      </section>
      <section className="panel profile-panel">
        <h2>Organization</h2>
        {configuration.isPending && <p role="status">Loading organization settings…</p>}
        {configuration.isError && (
          <button className="secondary" onClick={() => void configuration.refetch()}>
            Retry settings
          </button>
        )}
        {configuration.data && (
          <>
            <p>Business timezone {configuration.data.timezone}</p>
            {configuration.data.latestVersion && (
              <p>Android version {configuration.data.latestVersion}</p>
            )}
            {configuration.data.supportEmail && (
              <a href={'mailto:' + configuration.data.supportEmail}>Contact support</a>
            )}
          </>
        )}
      </section>
      <section className="panel profile-panel">
        <h2>API connection</h2>
        <p role="status">
          {health.isFetching
            ? 'Checking connection…'
            : health.error
              ? 'Could not connect to the API.'
              : 'API is online.'}
        </p>
        <button
          className="secondary"
          disabled={health.isFetching}
          onClick={() => void health.refetch()}
        >
          Check connection
        </button>
      </section>
    </>
  );
}
const router = createBrowserRouter([
  { path: '/account/setup', element: <AccountSetup /> },
  {
    element: (
      <SessionProvider>
        <Outlet />
      </SessionProvider>
    ),
    children: [
      { path: '/login', element: <Login /> },
      {
        element: (
          <Protected>
            <Layout />
          </Protected>
        ),
        children: [
          { index: true, element: <AnalyticsDashboard /> },
          { path: '/employees', element: <EmployeesPage /> },
          { path: '/employees/new', element: <EmployeeForm /> },
          { path: '/employees/:id', element: <EmployeeProfile /> },
          { path: '/employees/:id/edit', element: <EditEmployee /> },
          { path: '/attendance', element: <AttendancePage /> },
          { path: '/attendance/:id', element: <AttendanceDetails /> },
          { path: '/visits', element: <FieldVisitsPage /> },
          { path: '/visits/evidence', element: <FieldVisitsPage evidenceMode /> },
          { path: '/visits/:id', element: <FieldVisitDetails /> },
          { path: '/reports', element: <AnalyticsDashboard /> },
          { path: '/reports/locations', element: <RecordedLocations /> },
          { path: '/settings', element: <Overview /> },
          {
            path: '*',
            element: (
              <p>
                Page unavailable. <Link to="/">Return to dashboard</Link>
              </p>
            ),
          },
        ],
      },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <Suspense
      fallback={
        <main className="page">
          <p role="status">Loading page…</p>
        </main>
      }
    >
      <RouterProvider router={router} />
    </Suspense>
  </QueryClientProvider>,
);
