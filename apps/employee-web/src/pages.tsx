import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowDownToLine,
  CalendarDays,
  ClipboardList,
  Clock3,
  MapPin,
  ShieldCheck,
  WifiOff,
} from 'lucide-react';
import type { AttendanceSubmission, CurrentAttendance, Visit } from '@renuka/shared';
import { api, ApiError, attendanceHistory, post, visitHistory, type Employee } from './api';
import { locate } from './device';
import type { QueuedDraft } from './offline';
import {
  Alert,
  formatDuration,
  formatTime,
  InstallPanel,
  Loading,
  message,
  Pager,
  Pill,
  Resource,
  Title,
  useInstall,
  useResource,
} from './ui';

function ShiftClock({ shift }: { shift: CurrentAttendance }) {
  const [tick, setTick] = useState(Date.now);
  const [received, setReceived] = useState(Date.now);
  useEffect(() => {
    setReceived(Date.now());
  }, [shift.serverTime]);
  const running = shift.attendance?.status === 'CHECKED_IN';
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  if (!running) return <>{formatDuration(shift.attendance?.workingMinutes)}</>;
  const elapsed = Math.floor(
    Math.max(
      0,
      Date.parse(shift.serverTime) +
        Math.max(0, tick - received) -
        Date.parse(shift.attendance!.checkInTime),
    ) / 1000,
  );
  return (
    <>
      {[Math.floor(elapsed / 3600), Math.floor(elapsed / 60) % 60, elapsed % 60]
        .map((value) => String(value).padStart(2, '0'))
        .join(':')}
    </>
  );
}

export function Dashboard({
  employee,
  shift,
  shiftError,
  retry,
  queuedCount,
}: {
  employee: Employee;
  shift?: CurrentAttendance;
  shiftError: string;
  retry: () => void;
  queuedCount: number;
}) {
  const visits = useResource(() => visitHistory(1, 8), []);
  const active = shift?.attendance?.status === 'CHECKED_IN';
  const date = shift
    ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'full', timeZone: shift.timezone }).format(
        new Date(shift.serverTime),
      )
    : undefined;
  const first = employee.fullName.trim().split(/\s+/)[0] ?? employee.fullName;
  return (
    <div className="dashboard stack">
      <section className="dashboard-hero">
        <div className="hero-copy">
          {date && (
            <span className="hero-date">
              <CalendarDays size={17} /> {date}
            </span>
          )}
          <h1>Hello, {first}.</h1>
          <p>Manage your shift and field visits.</p>
        </div>
        <div className="shift-card">
          <div className="shift-status">
            <Clock3 size={20} />{' '}
            <span>
              {shift
                ? active
                  ? 'On duty'
                  : shift.attendance?.status === 'CHECKED_OUT'
                    ? 'Shift complete'
                    : 'Not checked in'
                : 'Attendance'}
            </span>
          </div>
          <div className="clock">{shift ? <ShiftClock shift={shift} /> : '—'}</div>
          <span className="shift-label">Working time</span>
          <Link className="button primary wide" to="/attendance">
            {active ? 'Check out' : 'Open attendance'}
          </Link>
        </div>
      </section>
      {shiftError && (
        <div className="actions">
          <Alert error={shiftError} />
          <button className="button secondary" onClick={retry}>
            Retry shift status
          </button>
        </div>
      )}
      <div className="quick-grid">
        <Link className="quick card" to="/visits/new">
          <span className="record-icon">
            <MapPin />
          </span>
          <strong>New field visit</strong>
          <span>Record a client or site visit</span>
        </Link>
        <Link className="quick card" to="/attendance/history">
          <span className="record-icon">
            <CalendarDays />
          </span>
          <strong>Attendance history</strong>
          <span>Review your working hours</span>
        </Link>
        <Link className="quick card" to="/sync">
          <span className="record-icon">
            <WifiOff />
          </span>
          <strong>Synchronization</strong>
          <span>{queuedCount ? queuedCount + ' draft(s) waiting' : 'No pending drafts'}</span>
        </Link>
      </div>
      <div className="dashboard-lower">
        <section className="card stack">
          <div className="section-head">
            <h2>Recent activity</h2>
            <Link to="/visits">View visits</Link>
          </div>
          <Resource state={visits}>
            {(data) =>
              data.visits.length ? (
                <ul className="records">
                  {data.visits.slice(0, 5).map((visit) => (
                    <li key={visit.id}>
                      <Link to={'/visits/' + visit.id}>
                        <span className="record-icon">
                          <MapPin size={18} />
                        </span>
                        <span className="record-copy">
                          <strong>{visit.clientName}</strong>
                          <span>{visit.visitDate}</span>
                        </span>
                        <Pill value={visit.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No visit activity yet.</p>
              )
            }
          </Resource>
        </section>
        <section className="card stack">
          <div className="section-head">
            <h2>Visit overview</h2>
            <Link to="/reports">Reports</Link>
          </div>
          <Resource state={visits}>
            {(data) => (
              <div className="stat-list">
                <div>
                  <span>
                    <ClipboardList size={18} /> Total visits
                  </span>
                  <strong>{data.total}</strong>
                </div>
                <div>
                  <span>
                    <ShieldCheck size={18} /> Approved · recent
                  </span>
                  <strong>
                    {data.visits.filter((visit) => visit.status === 'APPROVED').length}
                  </strong>
                </div>
                <div>
                  <span>
                    <Clock3 size={18} /> In review · recent
                  </span>
                  <strong>
                    {data.visits.filter((visit) => visit.status === 'PENDING_REVIEW').length}
                  </strong>
                </div>
              </div>
            )}
          </Resource>
        </section>
      </div>
    </div>
  );
}

export function Attendance({
  shift,
  error,
  refresh,
}: {
  shift?: CurrentAttendance;
  error: string;
  refresh: () => void;
}) {
  const [busy, setBusy] = useState('');
  const [problem, setProblem] = useState('');
  const [notice, setNotice] = useState('');
  const pending = useRef<{ path: string; body: AttendanceSubmission } | undefined>(undefined);
  const lock = useRef(false);
  const [lifecycle] = useState(() => new AbortController());
  useEffect(() => () => lifecycle.abort(), [lifecycle]);
  async function submit() {
    if (lock.current || !shift) return;
    lock.current = true;
    setProblem('');
    setNotice('');
    try {
      if (!pending.current) {
        setBusy('Verifying GPS…');
        const location = await locate(shift.limits, lifecycle.signal);
        const active = shift.attendance?.status === 'CHECKED_IN';
        pending.current = {
          path: active ? '/attendance/check-out' : '/attendance/check-in',
          body: {
            location,
            idempotencyKey: crypto.randomUUID(),
            ...(active && { attendanceId: shift.attendance!.id }),
          },
        };
      }
      setBusy('Saving attendance…');
      await api(pending.current.path, post(pending.current.body));
      setNotice(
        pending.current.path.endsWith('check-in') ? 'Check-in confirmed.' : 'Check-out confirmed.',
      );
      pending.current = undefined;
      refresh();
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status > 0 &&
        error.status < 500 &&
        error.status !== 429
      )
        pending.current = undefined;
      setProblem(message(error));
    } finally {
      lock.current = false;
      setBusy('');
    }
  }
  const checkedIn = shift?.attendance?.status === 'CHECKED_IN';
  return (
    <>
      <Title
        title="Attendance"
        description="Verify your location when starting or ending your shift."
        action={
          <Link className="button secondary" to="/attendance/history">
            Attendance history
          </Link>
        }
      />
      <Alert error={error || problem} />
      {error && (
        <button className="button secondary" onClick={refresh}>
          Retry shift status
        </button>
      )}
      {notice && (
        <div className="success" role="status">
          {notice}
        </div>
      )}
      {!shift && !error && <Loading label="Loading shift…" />}
      {shift && (
        <section className="card stack attendance-card">
          <div className="section-head">
            <h2>Current shift</h2>
            <Pill value={shift.attendance?.status ?? 'Not checked in'} />
          </div>
          <div className="large-clock">
            <ShiftClock shift={shift} />
          </div>
          <dl className="details">
            <div>
              <dt>Business date</dt>
              <dd>{shift.attendanceDate}</dd>
            </div>
            <div>
              <dt>Check-in</dt>
              <dd>{formatTime(shift.attendance?.checkInTime, shift.timezone)}</dd>
            </div>
            <div>
              <dt>Check-out</dt>
              <dd>{formatTime(shift.attendance?.checkOutTime, shift.timezone)}</dd>
            </div>
          </dl>
          <button
            className="button primary"
            disabled={!!busy || (!!shift.attendance && !checkedIn && !pending.current)}
            onClick={() => void submit()}
          >
            <MapPin size={18} />
            {busy ||
              (pending.current
                ? 'Retry attendance submission'
                : checkedIn
                  ? 'Check out'
                  : 'Check in')}
          </button>
        </section>
      )}
    </>
  );
}

export function History() {
  const [page, setPage] = useState(1);
  const state = useResource(() => attendanceHistory(page), [page]);
  return (
    <>
      <Title
        title="Attendance history"
        description="Review check-in times and recorded working hours."
      />
      <Resource state={state}>
        {(data) => (
          <section className="card stack">
            <div className="summary-line">
              <Clock3 size={20} />
              <span>Working time on this page</span>
              <strong>
                {formatDuration(
                  data.records.reduce((sum, item) => sum + (item.workingMinutes ?? 0), 0),
                )}
              </strong>
            </div>
            {data.records.length ? (
              <ul className="records">
                {data.records.map((row) => (
                  <li key={row.id}>
                    <div className="record-row">
                      <span className="record-icon">
                        <CalendarDays size={19} />
                      </span>
                      <span className="record-copy">
                        <strong>{row.attendanceDate}</strong>
                        <span>
                          {formatTime(row.checkInTime, row.timezone)} to{' '}
                          {formatTime(row.checkOutTime, row.timezone)} ·{' '}
                          {formatDuration(row.workingMinutes)}
                        </span>
                      </span>
                      <Pill value={row.status} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No attendance records yet.</p>
            )}
            <Pager page={page} hasNext={page < data.pagination.totalPages} setPage={setPage} />
          </section>
        )}
      </Resource>
    </>
  );
}

const counts = (visits: Visit[], status: Visit['status']) =>
  visits.filter((visit) => visit.status === status).length;
export function Reports() {
  const resource = useResource(
    () => Promise.all([attendanceHistory(1, 30), visitHistory(1, 30)]),
    [],
  );
  return (
    <>
      <Title
        title="Performance reports"
        description="Based on up to 30 recent attendance records and 30 recent visits."
      />
      <Resource state={resource}>
        {([attendance, visits]) => (
          <>
            <div className="quick-grid">
              <article className="card stack">
                <Clock3 />
                <h2>Working time</h2>
                <strong className="stat-number">
                  {formatDuration(
                    attendance.records.reduce((sum, row) => sum + (row.workingMinutes ?? 0), 0),
                  )}
                </strong>
              </article>
              <article className="card stack">
                <Activity />
                <h2>Recorded shifts</h2>
                <strong className="stat-number">{attendance.records.length}</strong>
              </article>
              <article className="card stack">
                <ShieldCheck />
                <h2>Approved visits</h2>
                <strong className="stat-number">{counts(visits.visits, 'APPROVED')}</strong>
              </article>
            </div>
            <section className="card stack">
              <h2>Visit outcomes</h2>
              <div className="stat-list">
                {(['APPROVED', 'PENDING_REVIEW', 'REJECTED', 'DRAFT'] as const).map((status) => (
                  <div key={status}>
                    <Pill value={status} />
                    <strong>{counts(visits.visits, status)}</strong>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </Resource>
    </>
  );
}

export function Notifications() {
  const resource = useResource(() => visitHistory(1, 30), []);
  return (
    <>
      <Title title="Notifications" description="Recent visit review activity." />
      <Resource state={resource}>
        {(data) => {
          const items = data.visits
            .filter((row) => row.reviewedAt)
            .sort((a, b) => b.reviewedAt!.localeCompare(a.reviewedAt!));
          return (
            <section className="card stack">
              {items.length ? (
                <ul className="records">
                  {items.map((visit) => (
                    <li key={visit.id}>
                      <Link to={'/visits/' + visit.id}>
                        <span className="record-icon">
                          <ShieldCheck size={18} />
                        </span>
                        <span className="record-copy">
                          <strong>{visit.clientName}</strong>
                          <span>{new Date(visit.reviewedAt!).toLocaleString()}</span>
                        </span>
                        <Pill value={visit.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No recent visit reviews.</p>
              )}
            </section>
          );
        }}
      </Resource>
    </>
  );
}

export function Profile({ employee }: { employee: Employee }) {
  return (
    <>
      <Title title="Employee profile" />
      <section className="card stack profile-card">
        <div className="avatar">{employee.fullName.trim().charAt(0).toUpperCase()}</div>
        <h2>{employee.fullName}</h2>
        <dl className="details">
          {[
            ['Employee ID', employee.employeeCode],
            ['Department', employee.department],
            ['Designation', employee.designation],
            ['Email', employee.email],
            ['Phone', employee.phone],
          ].map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{value || '—'}</dd>
            </div>
          ))}
        </dl>
        <Link className="button secondary" to="/settings">
          Settings
        </Link>
      </section>
    </>
  );
}
export function Settings({ install }: { install: ReturnType<typeof useInstall> }) {
  return (
    <>
      <Title title="Settings" description="Installation and device access." />
      <InstallPanel install={install} />
      <section className="card stack">
        <h2>Device permissions</h2>
        <p>
          Manage location and camera access in your browser’s site settings. Location is used during
          attendance and visit verification.
        </p>
        <Link to="/help">Help and support</Link>
      </section>
    </>
  );
}
export function Help() {
  return (
    <>
      <Title title="Help and support" />
      <section className="card stack">
        <h2>Common questions</h2>
        <details>
          <summary>How do I activate my account?</summary>
          <p>Ask your company administrator for a one-time activation link.</p>
        </details>
        <details>
          <summary>Why is the camera or GPS unavailable?</summary>
          <p>
            Open the app over HTTPS in Chrome on Android or Safari on iPhone. Allow camera and
            precise location when asked. Keep the page open while your location is verified.
          </p>
        </details>
        <details>
          <summary>What works offline?</summary>
          <p>
            An already signed-in employee with a loaded active shift can save a text visit draft for
            synchronization. Attendance and photo upload require a connection.
          </p>
        </details>
        <details>
          <summary>Who can help with an account or visit?</summary>
          <p>Contact your Renuka administrator for account, attendance, or review help.</p>
        </details>
      </section>
    </>
  );
}
export function Sync({
  rows,
  online,
  busy,
  error,
  sync,
  discard,
}: {
  rows: QueuedDraft[];
  online: boolean;
  busy: boolean;
  error: string;
  sync: () => void;
  discard: (key: string) => void;
}) {
  return (
    <>
      <Title
        title="Offline synchronization"
        description="Text drafts waiting to be saved to the server."
        action={<Pill value={online ? 'Online' : 'Offline'} />}
      />
      <section className="card stack">
        <div className="section-head">
          <h2>{rows.length ? rows.length + ' pending draft(s)' : 'You’re up to date'}</h2>
          <ArrowDownToLine size={22} />
        </div>
        <Alert error={error} />
        {rows.length > 0 && (
          <ul className="records">
            {rows.map((row) => (
              <li key={row.key}>
                <div className="record-row">
                  <span className="record-copy">
                    <strong>{row.input.clientName}</strong>
                    <span>
                      {row.failure || 'Expires ' + new Date(row.expiresAt).toLocaleString()}
                    </span>
                  </span>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm('Discard this local draft?')) discard(row.key);
                    }}
                  >
                    Discard
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <button
          className="button primary"
          disabled={!online || busy || !rows.some((row) => !row.failure)}
          onClick={sync}
        >
          {busy ? 'Synchronizing…' : 'Sync now'}
        </button>
      </section>
    </>
  );
}
