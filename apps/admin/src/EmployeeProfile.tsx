import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Pencil } from 'lucide-react';
import { Link, useLocation, useParams } from 'react-router-dom';
import type { Employee, EmployeeStatus } from '@renuka/shared';
import { employeeApi, type SetupLink } from './api';
import { initials, LoadError, StatusBadge } from './EmployeesPage';
import { useSession } from './session';

export function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="panel dialog"
      aria-labelledby="dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <h2 id="dialog-title">{title}</h2>
      {children}
    </dialog>
  );
}

const dateTime = (text: string | null) =>
  text
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(text),
      )
    : '—';
const words: Record<EmployeeStatus, string> = {
  ACTIVE: 'Activate',
  INACTIVE: 'Deactivate',
  SUSPENDED: 'Suspend',
};

function Audit({ id }: { id: string }) {
  const [page, setPage] = useState(1);
  const audit = useQuery({
    queryKey: ['employees', 'audit', id, page],
    queryFn: ({ signal }) => employeeApi.audit(id, page, signal),
  });
  return (
    <section className="panel profile-panel">
      <h2>Employee audit log</h2>
      {audit.error ? (
        <LoadError error={audit.error} retry={() => void audit.refetch()} />
      ) : audit.isPending ? (
        <p role="status">Loading audit events…</p>
      ) : audit.data.events.length === 0 ? (
        <p>No events on this page.</p>
      ) : (
        <ul className="audit-list">
          {audit.data.events.map((event) => (
            <li key={event._id}>
              <strong>{event.action.replaceAll('_', ' ').toLowerCase()}</strong>
              <time>{dateTime(event.createdAt)}</time>
              {event.metadata?.reason && <p>{event.metadata.reason}</p>}
              {event.metadata?.changedFields?.length ? (
                <p>Changed {event.metadata.changedFields.join(', ')}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <div className="row-actions">
        <button
          className="secondary"
          disabled={page === 1 || audit.isFetching}
          onClick={() => setPage(page - 1)}
        >
          Previous
        </button>
        <button
          className="secondary"
          disabled={audit.data?.events.length !== 10 || audit.isFetching}
          onClick={() => setPage(page + 1)}
        >
          Next
        </button>
      </div>
    </section>
  );
}

function Profile({ employee }: { employee: Employee }) {
  const location = useLocation();
  const access = useRef<HTMLElement>(null);
  useEffect(() => {
    if (location.hash === '#account-access') access.current?.focus();
  }, [location.hash]);
  const user = useSession();
  const query = useQueryClient();
  const [notice, setNotice] = useState<string>(location.state?.notice ?? '');
  const [target, setTarget] = useState<EmployeeStatus>();
  const [issue, setIssue] = useState(false);
  const [link, setLink] = useState<SetupLink>();
  const [copied, setCopied] = useState(false);
  const status = useMutation({
    mutationFn: ({ state, reason }: { state: EmployeeStatus; reason?: string }) =>
      employeeApi.status(employee.id, { status: state, reason, revision: employee.revision }),
    onSuccess: async () => {
      setTarget(undefined);
      setNotice('Account status updated.');
      await query.invalidateQueries({ queryKey: ['employees'] });
    },
  });
  const reset = useMutation({
    mutationFn: () => employeeApi.issue(employee.id),
    onSuccess: (result) => {
      setLink(result);
      void query.invalidateQueries({ queryKey: ['employees', 'audit', employee.id] });
    },
  });
  const linkText = link
    ? new URL('/account/setup#token=' + encodeURIComponent(link.token), window.location.origin).href
    : '';
  const statusActions: EmployeeStatus[] = (['ACTIVE', 'INACTIVE', 'SUSPENDED'] as const).filter(
    (state) => state !== employee.status && !(employee.onboardingPending && state === 'ACTIVE'),
  );
  function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target) return;
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim();
    status.mutate({ state: target, reason: reason || undefined });
  }
  function closeIssue() {
    if (reset.isPending) return;
    setIssue(false);
    setLink(undefined);
    setCopied(false);
    reset.reset();
  }
  const details = [
    ['Email', employee.email],
    ['Phone', employee.phone],
    ['Joining date', employee.dateOfJoining ?? '—'],
    ['Last login', dateTime(employee.lastLoginAt)],
    ['Created', dateTime(employee.createdAt)],
    ['Last updated', dateTime(employee.updatedAt)],
  ];
  return (
    <>
      <header className="page-heading">
        <div>
          <Link to="/employees" className="back-link">
            Back to employees
          </Link>
          <h1>Employee profile</h1>
        </div>
        <Link className="secondary" to={'/employees/' + employee.id + '/edit'}>
          <Pencil size={17} /> Edit profile
        </Link>
      </header>
      {notice && (
        <p role="status" className="notice success-notice">
          {notice}
        </p>
      )}
      <section className="panel profile-panel">
        <div className="profile-intro">
          <span className="avatar large">{initials(employee.fullName)}</span>
          <div>
            <h2>{employee.fullName}</h2>
            <p>
              {employee.employeeCode} · {employee.designation} · {employee.department}
            </p>
          </div>
          <StatusBadge status={employee.status} />
        </div>
        <dl className="profile-details">
          {details.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="panel profile-panel" id="account-access" ref={access} tabIndex={-1}>
        <h2>Account access</h2>
        {employee.onboardingPending && <p>Account setup is pending.</p>}
        <div className="account-actions">
          {(employee.status === 'ACTIVE' ||
            (employee.onboardingPending && employee.status === 'INACTIVE')) && (
            <button className="secondary" onClick={() => setIssue(true)}>
              <KeyRound size={17} />{' '}
              {employee.onboardingPending ? 'Issue activation link' : 'Initiate password reset'}
            </button>
          )}
          {statusActions.map((state) => (
            <button
              className={state === 'ACTIVE' ? 'secondary' : 'secondary danger'}
              key={state}
              onClick={() => {
                status.reset();
                setTarget(state);
              }}
            >
              {employee.onboardingPending && state === 'INACTIVE'
                ? 'Return to onboarding'
                : words[state] + ' account'}
            </button>
          ))}
        </div>
      </section>
      {user?.role === 'SUPER_ADMIN' && <Audit id={employee.id} />}
      <div className="future-grid">
        <section className="panel profile-panel">
          <h2>Attendance history</h2>
          <Link className="back-link" to={'/attendance?employeeId=' + employee.id}>
            View attendance
          </Link>
        </section>
        <section className="panel profile-panel">
          <h2>Field visit history</h2>
          <Link className="back-link" to={'/visits?employeeId=' + employee.id}>
            View field visits
          </Link>
        </section>
      </div>
      {target && (
        <Modal
          title={words[target] + ' ' + employee.employeeCode}
          close={() => {
            if (!status.isPending) setTarget(undefined);
          }}
        >
          <form className="dialog-form" onSubmit={confirm}>
            <p>
              {target === 'ACTIVE'
                ? 'The employee will be able to sign in again.'
                : 'The employee will lose mobile access and existing sessions will be revoked. Historical records will remain available.'}
            </p>
            {target !== 'ACTIVE' && (
              <label>
                Reason
                <textarea required minLength={3} maxLength={240} name="reason" rows={3} />
              </label>
            )}
            {status.error && (
              <p className="error-text" role="alert">
                {status.error.message}
              </p>
            )}
            <div className="form-actions">
              <button
                type="button"
                className="secondary"
                disabled={status.isPending}
                onClick={() => setTarget(undefined)}
              >
                Cancel
              </button>
              <button className="primary" disabled={status.isPending}>
                {status.isPending ? 'Updating…' : 'Confirm'}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {issue && (
        <Modal
          title={employee.onboardingPending ? 'Issue activation link' : 'Issue password reset link'}
          close={closeIssue}
        >
          <div className="dialog-form">
            {link ? (
              <>
                <p>
                  Share this once through an approved secure channel. It expires{' '}
                  {dateTime(link.expiresAt)}.
                </p>
                <label>
                  One-time link
                  <input value={linkText} readOnly onFocus={(event) => event.target.select()} />
                </label>
                <button
                  className="secondary"
                  onClick={() =>
                    void navigator.clipboard
                      ?.writeText(linkText)
                      .then(() => setCopied(true))
                      .catch(() => setCopied(false))
                  }
                >
                  <Copy size={16} /> {copied ? 'Copied' : 'Copy link'}
                </button>
              </>
            ) : (
              <>
                <p>Issuing a link replaces any previously issued link for this employee.</p>
                {reset.error && (
                  <p className="error-text" role="alert">
                    {reset.error.message}
                  </p>
                )}
                <button
                  className="primary"
                  disabled={reset.isPending}
                  onClick={() => reset.mutate()}
                >
                  {reset.isPending ? 'Issuing…' : 'Issue one-time link'}
                </button>
              </>
            )}
            <button className="secondary" disabled={reset.isPending} onClick={closeIssue}>
              {link ? 'Done' : 'Cancel'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

export function EmployeeProfile() {
  const { id = '' } = useParams();
  const employee = useQuery({
    queryKey: ['employees', 'detail', id],
    queryFn: ({ signal }) => employeeApi.detail(id, signal),
  });
  if (employee.isPending) return <p role="status">Loading employee…</p>;
  if (employee.error)
    return (
      <>
        <Link to="/employees">Back to employees</Link>
        <LoadError error={employee.error} retry={() => void employee.refetch()} />
      </>
    );
  return employee.data ? <Profile key={employee.data.id} employee={employee.data} /> : null;
}
