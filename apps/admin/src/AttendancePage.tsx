import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  AlarmClock,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  MapPin,
  UserMinus,
  Users,
} from 'lucide-react';
import type { AttendanceLocation, AttendanceStatus } from '@renuka/shared';
import { attendanceApi, type AttendanceFilters } from './attendance.api';
import { LoadError } from './EmployeesPage';

const labels: Record<AttendanceStatus, string> = {
  CHECKED_IN: 'On duty',
  CHECKED_OUT: 'Checked out',
  INCOMPLETE: 'Incomplete',
};
const tones: Record<AttendanceStatus, string> = {
  CHECKED_IN: 'active',
  CHECKED_OUT: 'inactive',
  INCOMPLETE: 'suspended',
};
const time = (iso: string | null, zone: string, date = false) =>
  iso
    ? new Intl.DateTimeFormat(undefined, {
        timeStyle: 'short',
        ...(date ? { dateStyle: 'medium' } : {}),
        timeZone: zone,
      }).format(new Date(iso))
    : '—';
const duration = (minutes: number | null) =>
  minutes == null ? '—' : Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm';
const badge = (status: AttendanceStatus) => (
  <span className={'badge ' + tones[status]}>{labels[status]}</span>
);

export function AttendancePage() {
  const [params] = useSearchParams();
  const candidate = params.get('employeeId');
  const employeeId = candidate && /^[a-f0-9]{24}$/i.test(candidate) ? candidate : undefined;
  const [text, setText] = useState('');
  const [filters, setFilters] = useState<AttendanceFilters>(() => ({
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
    department: params.get('department') ?? undefined,
    page: 1,
    limit: 20,
    sortOrder: 'desc',
    sortBy: 'checkInTime',
  }));
  useEffect(() => {
    const timer = setTimeout(
      () =>
        setFilters((old) =>
          old.search === (text.trim() || undefined)
            ? old
            : { ...old, page: 1, search: text.trim() || undefined },
        ),
      300,
    );
    return () => clearTimeout(timer);
  }, [text]);
  const scoped = { ...filters, employeeId };
  const change = (update: Partial<AttendanceFilters>) =>
    setFilters((old) => ({ ...old, ...update, page: 1 }));
  const invalid = !!(filters.from && filters.to && filters.to < filters.from);
  const stats = useQuery({
    queryKey: ['attendance', 'stats'],
    queryFn: ({ signal }) => attendanceApi.stats(signal),
  });
  const list = useQuery({
    queryKey: ['attendance', 'list', scoped],
    enabled: !invalid,
    queryFn: ({ signal }) => attendanceApi.list(scoped, signal),
    placeholderData: keepPreviousData,
  });
  const download = useMutation({
    mutationFn: () => {
      const criteria = { ...scoped };
      delete criteria.limit;
      delete criteria.page;
      return attendanceApi.export(criteria);
    },
  });
  const cards = [
    ['Total employees', stats.data?.totalEmployees, Users, 'purple'],
    ['Currently on duty', stats.data?.currentlyOnDuty, Clock, 'green'],
    ['Checked out today', stats.data?.checkedOutToday, CalendarCheck, 'slate'],
    ['Not checked in today', stats.data?.notCheckedInToday, UserMinus, 'slate'],
    ['Incomplete sessions', stats.data?.incompleteSessions, AlarmClock, 'amber'],
  ] as const;
  const paging = list.data?.pagination;
  return (
    <>
      <header className="page-heading">
        <div>
          <h1>Attendance Management</h1>
          <p>
            {stats.data
              ? stats.data.attendanceDate + ' · ' + stats.data.timezone
              : 'Review shifts and working hours.'}
          </p>
        </div>
        <button
          className="secondary"
          disabled={download.isPending || invalid}
          onClick={() => download.mutate()}
        >
          <Download size={17} />
          {download.isPending ? 'Exporting…' : 'Export CSV'}
        </button>
      </header>
      {download.error && (
        <p role="alert" className="error-text">
          {download.error.message}
        </p>
      )}
      {stats.error && <LoadError error={stats.error} retry={() => void stats.refetch()} />}
      <div className="summary-grid attendance-grid" aria-label="Attendance statistics">
        {cards.map(([name, value, Icon, tone]) => (
          <article className="panel stat" key={name}>
            <span className={'stat-icon ' + tone}>
              <Icon size={20} />
            </span>
            <span>{name}</span>
            <strong>{value ?? '—'}</strong>
          </article>
        ))}
      </div>
      <section className="panel directory">
        <div className="section-heading">
          <div>
            <h2>Attendance records</h2>
            <p>{paging ? paging.total + ' sessions' : 'Recorded sessions'}</p>
          </div>
          {employeeId && (
            <Link to="/attendance" className="secondary">
              Show all employees
            </Link>
          )}
        </div>
        <div className="filters attendance-filters">
          <label>
            Employee
            <input
              type="search"
              maxLength={80}
              value={text}
              placeholder="Name, email or ID"
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <label>
            Department
            <select
              value={filters.department ?? ''}
              onChange={(e) => change({ department: e.target.value || undefined })}
            >
              <option value="">All departments</option>
              {stats.data?.departments.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </label>
          <label>
            From
            <input
              type="date"
              value={filters.from ?? ''}
              onChange={(e) => change({ from: e.target.value || undefined })}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={filters.to ?? ''}
              onChange={(e) => change({ to: e.target.value || undefined })}
            />
          </label>
          <label>
            Status
            <select
              value={filters.status ?? ''}
              onChange={(e) =>
                change({ status: (e.target.value || undefined) as AttendanceStatus | undefined })
              }
            >
              <option value="">All statuses</option>
              {Object.entries(labels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Sort
            <select
              value={filters.sortBy + ':' + filters.sortOrder}
              onChange={(e) => {
                const [sortBy, sortOrder] = e.target.value.split(':');
                change({ sortBy, sortOrder: sortOrder === 'asc' ? 'asc' : 'desc' });
              }}
            >
              <option value="checkInTime:desc">Newest check-in</option>
              <option value="checkInTime:asc">Oldest check-in</option>
              <option value="workingMinutes:desc">Longest duration</option>
            </select>
          </label>
        </div>
        {invalid ? (
          <p role="alert" className="notice">
            End date must be on or after start date.
          </p>
        ) : list.error ? (
          <LoadError error={list.error} retry={() => void list.refetch()} />
        ) : list.isPending ? (
          <div role="status" className="skeletons">
            <span className="sr-only">Loading attendance</span>
            {[1, 2, 3].map((row) => (
              <div className="skeleton" key={row} />
            ))}
          </div>
        ) : !list.data?.records.length ? (
          <div className="empty">
            <p>No attendance records match these filters.</p>
          </div>
        ) : (
          <div className="table-scroll" role="region" aria-label="Attendance table" tabIndex={0}>
            <table aria-busy={list.isFetching}>
              <thead>
                <tr>
                  {[
                    'Employee ID',
                    'Employee name',
                    'Department',
                    'Date',
                    'Check-in',
                    'Checkout',
                    'Working time',
                    'Status',
                    'Actions',
                  ].map((label) => (
                    <th key={label} scope="col">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.data.records.map((row) => (
                  <tr key={row.id}>
                    <td>{row.employee?.employeeCode}</td>
                    <td>{row.employee?.fullName}</td>
                    <td>{row.employee?.department}</td>
                    <td>{row.attendanceDate}</td>
                    <td>{time(row.checkInTime, row.timezone)}</td>
                    <td>{time(row.checkOutTime, row.timezone)}</td>
                    <td>{duration(row.workingMinutes)}</td>
                    <td>{badge(row.status)}</td>
                    <td>
                      <Link
                        className="back-link"
                        to={'/attendance/' + row.id}
                        aria-label={'View attendance for ' + row.employee?.fullName}
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="pagination">
          <label>
            Rows per page{' '}
            <select
              value={filters.limit}
              onChange={(e) => change({ limit: Number(e.target.value) })}
            >
              {[20, 50, 100].map((rows) => (
                <option key={rows}>{rows}</option>
              ))}
            </select>
          </label>
          <div>
            <span>
              Page {filters.page} of {Math.max(1, paging?.totalPages ?? 1)}
            </span>
            <button
              className="secondary icon-button"
              aria-label="Previous page"
              disabled={invalid || list.isFetching || (filters.page ?? 1) <= 1}
              onClick={() => setFilters((old) => ({ ...old, page: (old.page ?? 1) - 1 }))}
            >
              <ChevronLeft size={17} />
            </button>
            <button
              className="secondary icon-button"
              aria-label="Next page"
              disabled={
                invalid || list.isFetching || (filters.page ?? 1) >= (paging?.totalPages ?? 1)
              }
              onClick={() => setFilters((old) => ({ ...old, page: (old.page ?? 1) + 1 }))}
            >
              <ChevronRight size={17} />
            </button>
          </div>
        </div>
      </section>
    </>
  );
}

function Location({
  title,
  location,
  timestamp,
}: {
  title: string;
  location?: AttendanceLocation;
  timestamp: string;
}) {
  return (
    <section className="panel profile-panel">
      <h2>{title}</h2>
      <p>{timestamp}</p>
      {location ? (
        <>
          <p>
            {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)} · ±
            {Math.round(location.accuracy)} m
          </p>
          <a
            className="secondary"
            href={
              'https://www.google.com/maps/search/?api=1&query=' +
              encodeURIComponent(location.latitude + ',' + location.longitude)
            }
            target="_blank"
            rel="noreferrer"
          >
            <MapPin size={16} />
            Open in Maps
          </a>
        </>
      ) : (
        <p>No recorded location.</p>
      )}
    </section>
  );
}

export function AttendanceDetails() {
  const { id = '' } = useParams();
  const result = useQuery({
    queryKey: ['attendance', 'detail', id],
    queryFn: ({ signal }) => attendanceApi.detail(id, signal),
  });
  const record = result.data;
  return (
    <>
      <header className="page-heading">
        <div>
          <Link className="back-link" to="/attendance">
            Back to attendance
          </Link>
          <h1>Attendance details</h1>
        </div>
        {record && badge(record.status)}
      </header>
      {result.error ? (
        <LoadError error={result.error} retry={() => void result.refetch()} />
      ) : !record ? (
        <p role="status">Loading attendance…</p>
      ) : (
        <>
          <section className="panel profile-panel">
            <h2>{record.employee?.fullName}</h2>
            <p>
              {record.employee?.employeeCode} · {record.employee?.department}
            </p>
            <p>
              {record.attendanceDate} · {record.timezone} · Working time{' '}
              {duration(record.workingMinutes)}
            </p>
            <p>Record {record.id}</p>
          </section>
          <div className="future-grid">
            <Location
              title="Check-in"
              location={record.checkInLocation}
              timestamp={time(record.checkInTime, record.timezone, true)}
            />
            <Location
              title="Checkout"
              location={record.checkOutLocation}
              timestamp={time(record.checkOutTime, record.timezone, true)}
            />
          </div>
        </>
      )}
    </>
  );
}
