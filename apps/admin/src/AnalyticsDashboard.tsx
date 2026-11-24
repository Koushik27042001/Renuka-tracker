import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Download, MapPin } from 'lucide-react';
import { analyticsApi, fieldApi, type FieldFilters } from './field.api';
import { EvidenceMap } from './EvidenceMap';
import { FieldFiltersBar, Pages } from './FieldVisitsPage';
import { LoadError } from './EmployeesPage';

const palette = ['#6848d3', '#087c5b', '#ae4737'];
function Chart({
  title,
  available,
  children,
}: {
  title: string;
  available: boolean;
  children: ReactNode;
}) {
  return (
    <section className="panel profile-panel chart-panel">
      <h2>{title}</h2>
      {available ? (
        <div className="chart-area" aria-label={title} role="region">
          {children}
        </div>
      ) : (
        <p>No records in this period.</p>
      )}
    </section>
  );
}
function valid(filters: FieldFilters) {
  const { from, to } = filters;
  return !(from && to && (from > to || Date.parse(to) - Date.parse(from) > 365 * 86400_000));
}
export function AnalyticsDashboard() {
  const [filters, setFilters] = useState<FieldFilters>({ interval: 'day' });
  const [page, setPage] = useState(1);
  const enabled = valid(filters);
  const overview = useQuery({
    queryKey: ['analytics', 'overview', filters],
    queryFn: ({ signal }) => analyticsApi.overview(filters, signal),
    enabled,
  });
  const attendance = useQuery({
    queryKey: ['analytics', 'attendance', filters],
    queryFn: ({ signal }) => analyticsApi.attendance(filters, signal),
    enabled,
  });
  const visits = useQuery({
    queryKey: ['analytics', 'visits', filters],
    queryFn: ({ signal }) => analyticsApi.visits(filters, signal),
    enabled,
  });
  const reviews = useQuery({
    queryKey: ['analytics', 'reviews', filters],
    queryFn: ({ signal }) => analyticsApi.reviews(filters, signal),
    enabled,
  });
  const team = useQuery({
    queryKey: ['analytics', 'employees', filters, page],
    queryFn: ({ signal }) => analyticsApi.employees({ ...filters, page, limit: 20 }, signal),
    enabled,
  });
  const exportReport = useMutation({
    mutationFn: (report: 'summary' | 'employees') => analyticsApi.export(filters, report),
  });
  const activity = useQuery({
    queryKey: ['visits', 'recent-activity', filters],
    queryFn: ({ signal }) => fieldApi.list({ ...filters, page: 1, limit: 5 }, signal),
    enabled,
  });
  const kpi = overview.data;
  function reportLink(path: string, visits = false) {
    const params = new URLSearchParams();
    const aligned = {
      from: kpi?.from ?? filters.from,
      to: kpi?.to ?? filters.to,
      department: filters.department,
      employeeId: filters.employeeId,
      ...(visits ? { status: filters.status } : {}),
    };
    for (const [key, value] of Object.entries(aligned)) if (value) params.set(key, value);
    return path + (params.size ? '?' + params : '');
  }
  const cards = [
    ['Total employees', kpi?.totalEmployees],
    ['Active employees', kpi?.activeEmployees],
    ['Currently checked in', kpi?.currentlyCheckedIn],
    ['Completed today', kpi?.completedAttendanceToday],
    ['Total field visits', kpi?.totalVisits],
    ['Visits today', kpi?.visitsToday],
    ['Pending reviews', kpi?.pendingReviews],
    ['Approved visits', kpi?.approvedVisits],
    ['Rejected visits', kpi?.rejectedVisits],
    [
      'Average working hours',
      kpi?.averageWorkingHours == null ? undefined : kpi.averageWorkingHours.toFixed(1),
    ],
  ];
  const outcomes = [
    { name: 'Pending', value: reviews.data?.pending ?? 0 },
    { name: 'Approved', value: reviews.data?.approved ?? 0 },
    { name: 'Rejected', value: reviews.data?.rejected ?? 0 },
  ];
  const work =
    attendance.data?.trend.map((row) => ({
      ...row,
      hours: Number((row.workingMinutes / 60).toFixed(2)),
    })) ?? [];
  const departments = attendance.data?.byDepartment ?? [];
  return (
    <>
      <header className="page-heading">
        <div>
          <h1>Operations analytics</h1>
          <p>
            {kpi
              ? kpi.from + ' through ' + kpi.to + ' · ' + kpi.timezone
              : 'Attendance, visits and review outcomes.'}
          </p>
        </div>
        <Link className="secondary" to="/reports/locations">
          <MapPin size={17} />
          Recorded locations
        </Link>
      </header>
      <div className="row-actions field-nav">
        <Link className="secondary" to={reportLink('/attendance')}>
          Attendance records
        </Link>
        <Link className="secondary" to={reportLink('/visits', true)}>
          Visit reports
        </Link>
        <Link className="secondary" to="/visits/evidence">
          Evidence table
        </Link>
        <button
          className="secondary"
          disabled={!enabled || exportReport.isPending}
          onClick={() => exportReport.mutate('summary')}
        >
          <Download size={16} />
          Summary CSV
        </button>
        <button
          className="secondary"
          disabled={!enabled || exportReport.isPending}
          onClick={() => exportReport.mutate('employees')}
        >
          Employee activity CSV
        </button>
      </div>
      <section className="panel directory">
        <FieldFiltersBar
          value={filters}
          analytics
          onChange={(update) => {
            setFilters((old) => ({ ...old, ...update }));
            setPage(1);
          }}
        />
      </section>
      {!enabled && (
        <p className="notice" role="alert">
          Select an ordered range of up to 366 days.
        </p>
      )}
      {enabled && (
        <section className="panel profile-panel">
          <h2>Recent field visits</h2>
          {activity.isPending && <p role="status">Loading visits…</p>}
          {activity.isError && (
            <button className="secondary" onClick={() => void activity.refetch()}>
              Retry recent visits
            </button>
          )}
          {activity.data?.visits.length === 0 && <p>No visits match these filters.</p>}
          {activity.data?.visits.map((visit) => (
            <p key={visit.id}>
              <Link to={'/visits/' + visit.id}>{visit.clientName}</Link> · {visit.visitDate} ·{' '}
              {visit.status.replaceAll('_', ' ').toLowerCase()}
            </p>
          ))}
        </section>
      )}
      {exportReport.error && (
        <p className="error-text" role="alert">
          {exportReport.error.message}
        </p>
      )}
      {overview.error && <LoadError error={overview.error} retry={() => void overview.refetch()} />}
      {enabled && overview.isPending && (
        <div className="skeletons" role="status">
          <span className="sr-only">Loading analytics</span>
          <div className="skeleton" />
        </div>
      )}
      {enabled && kpi && (
        <>
          <div className="summary-grid attendance-grid">
            {cards.map(([name, value]) => (
              <article className="panel stat" key={name}>
                <span>{name}</span>
                <strong>{value ?? '—'}</strong>
              </article>
            ))}
          </div>
          <p className="field-note">
            Recorded working time {Math.round(kpi.totalWorkingMinutes / 6) / 10} hours
            {reviews.data?.averageReviewHours != null
              ? ' · Average review turnaround ' +
                reviews.data.averageReviewHours.toFixed(1) +
                ' hours'
              : ''}
          </p>
          {attendance.error && (
            <LoadError error={attendance.error} retry={() => void attendance.refetch()} />
          )}
          {visits.error && <LoadError error={visits.error} retry={() => void visits.refetch()} />}
          {reviews.error && (
            <LoadError error={reviews.error} retry={() => void reviews.refetch()} />
          )}
          {(attendance.isFetching || visits.isFetching || reviews.isFetching) && (
            <p role="status">Updating charts…</p>
          )}
          <div className="field-detail-grid">
            <Chart title="Attendance trend" available={!!work.length}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={work} accessibilityLayer>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="_id" minTickGap={18} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="sessions"
                    name="Check-ins"
                    stroke={palette[0]}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="completed"
                    name="Completed"
                    stroke={palette[1]}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </Chart>
            <Chart title="Field visit trend" available={!!visits.data?.trend.length}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={visits.data?.trend} accessibilityLayer>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="_id" minTickGap={18} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="visits" name="Submitted visits" fill={palette[0]} />
                </BarChart>
              </ResponsiveContainer>
            </Chart>
            <Chart title="Review outcomes" available={outcomes.some((row) => row.value > 0)}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart accessibilityLayer>
                  <Pie
                    data={outcomes}
                    dataKey="value"
                    nameKey="name"
                    innerRadius="50%"
                    outerRadius="77%"
                  >
                    {outcomes.map((item, i) => (
                      <Cell key={item.name} fill={palette[i]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </Chart>
            <Chart title="Attendance by department" available={!!departments.length}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={departments} accessibilityLayer>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="department" minTickGap={15} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="completed" name="Completed" fill={palette[1]} />
                  <Bar dataKey="incomplete" name="Incomplete" fill={palette[2]} />
                </BarChart>
              </ResponsiveContainer>
            </Chart>
            <Chart title="Recorded working hours" available={work.some((row) => row.completed > 0)}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={work} accessibilityLayer>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="_id" minTickGap={18} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="hours" name="Working hours" fill={palette[0]} />
                </BarChart>
              </ResponsiveContainer>
            </Chart>
            <Chart title="Visits by department" available={!!visits.data?.byDepartment.length}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={visits.data?.byDepartment} accessibilityLayer>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="department" minTickGap={15} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="visits" name="Submitted visits" fill={palette[1]} />
                </BarChart>
              </ResponsiveContainer>
            </Chart>
          </div>
          <section className="panel directory">
            <header className="section-heading">
              <h2>Employee activity</h2>
            </header>
            {team.error ? (
              <LoadError error={team.error} retry={() => void team.refetch()} />
            ) : team.isPending ? (
              <p role="status" className="profile-panel">
                Loading activity…
              </p>
            ) : !team.data.employees.length ? (
              <p className="empty">No employees match these filters.</p>
            ) : (
              <>
                <div
                  className="table-scroll"
                  tabIndex={0}
                  role="region"
                  aria-label="Employee activity table"
                >
                  <table>
                    <thead>
                      <tr>
                        {[
                          'Employee',
                          'Department',
                          'Check-ins',
                          'Completed',
                          'Incomplete',
                          'Working hours',
                          'Visits',
                        ].map((value) => (
                          <th scope="col" key={value}>
                            {value}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {team.data.employees.map((row) => (
                        <tr key={row.id}>
                          <td>
                            <Link to={'/employees/' + row.id}>
                              {row.employeeCode} · {row.fullName}
                            </Link>
                          </td>
                          <td>{row.department}</td>
                          <td>{row.sessions}</td>
                          <td>{row.completed}</td>
                          <td>{row.incomplete}</td>
                          <td>{(row.workingMinutes / 60).toFixed(1)}</td>
                          <td>{row.visits}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pages
                  page={page}
                  limit={team.data.limit}
                  total={team.data.total}
                  onPage={setPage}
                />
              </>
            )}
          </section>
        </>
      )}
    </>
  );
}

export function RecordedLocations() {
  const [filters, setFilters] = useState<FieldFilters>({ page: 1, limit: 250 });
  const enabled = valid(filters);
  const result = useQuery({
    queryKey: ['analytics', 'locations', filters],
    queryFn: ({ signal }) => analyticsApi.locations(filters, signal),
    enabled,
  });
  return (
    <>
      <header className="page-heading">
        <div>
          <Link className="back-link" to="/reports">
            Back to reports
          </Link>
          <h1>Recorded visit locations</h1>
          <p>Each marker represents a submitted GPS selfie.</p>
        </div>
      </header>
      <section className="panel directory">
        <FieldFiltersBar
          value={filters}
          onChange={(update) => setFilters((old) => ({ ...old, ...update, page: 1 }))}
        />
        {!enabled ? (
          <p className="notice" role="alert">
            Select an ordered range of up to 366 days.
          </p>
        ) : result.error ? (
          <LoadError error={result.error} retry={() => void result.refetch()} />
        ) : result.isPending ? (
          <p role="status" className="profile-panel">
            Loading recorded locations…
          </p>
        ) : (
          <>
            <EvidenceMap markers={result.data.markers} />
            <Pages
              page={filters.page ?? 1}
              total={result.data.total}
              limit={result.data.limit}
              onPage={(page) => setFilters((old) => ({ ...old, page }))}
            />
          </>
        )}
      </section>
    </>
  );
}
