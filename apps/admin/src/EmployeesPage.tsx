import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Plus,
  Search,
  Users,
  UserCheck,
  UserMinus,
  ShieldAlert,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { employeeStatuses, type EmployeeStatus } from '@renuka/shared';
import { employeeApi, type Filters } from './api';

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
export const titleCase = (value: string) => value[0] + value.slice(1).toLowerCase();
export function StatusBadge({ status }: { status: EmployeeStatus }) {
  return <span className={'badge ' + status.toLowerCase()}>{titleCase(status)}</span>;
}
export function LoadError({ retry, error }: { retry: () => void; error: Error }) {
  return (
    <div className="notice" role="alert">
      <p>{error.message}</p>
      <button className="secondary" onClick={retry}>
        Retry
      </button>
    </div>
  );
}

export function EmployeesPage() {
  const [input, setInput] = useState('');
  const [filters, setFilters] = useState<Filters>({
    page: 1,
    limit: 10,
    sortBy: 'createdAt',
    sortOrder: 'desc',
  });
  useEffect(() => {
    const timer = setTimeout(
      () =>
        setFilters((old) =>
          old.search === (input.trim() || undefined)
            ? old
            : { ...old, search: input.trim() || undefined, page: 1 },
        ),
      300,
    );
    return () => clearTimeout(timer);
  }, [input]);
  const list = useQuery({
    queryKey: ['employees', 'list', filters],
    queryFn: ({ signal }) => employeeApi.list(filters, signal),
    placeholderData: keepPreviousData,
  });
  const stats = useQuery({
    queryKey: ['employees', 'stats'],
    queryFn: ({ signal }) => employeeApi.stats(signal),
  });
  const download = useMutation({
    mutationFn: () => {
      const criteria = { ...filters };
      delete criteria.page;
      delete criteria.limit;
      return employeeApi.export(criteria);
    },
  });
  const change = (next: Partial<Filters>) => setFilters((old) => ({ ...old, ...next, page: 1 }));
  const paging = list.data?.pagination;
  const cards = [
    { name: 'Total employees', value: stats.data?.totalEmployees, icon: Users, tone: 'purple' },
    {
      name: 'Active employees',
      value: stats.data?.activeEmployees,
      icon: UserCheck,
      tone: 'green',
    },
    {
      name: 'Inactive employees',
      value: stats.data?.inactiveEmployees,
      icon: UserMinus,
      tone: 'slate',
    },
    {
      name: 'Suspended employees',
      value: stats.data?.suspendedEmployees,
      icon: ShieldAlert,
      tone: 'amber',
    },
  ];
  return (
    <>
      <header className="page-heading">
        <div>
          <h1>Employee Management</h1>
          <p>Manage employee profiles, departments, and account access.</p>
        </div>
        <Link className="primary" to="/employees/new">
          <Plus size={18} /> Add Employee
        </Link>
      </header>
      <div className="summary-grid" aria-label="Employee statistics">
        {cards.map(({ name, value, icon: Icon, tone }) => (
          <article className="panel stat" key={name}>
            <span className={'stat-icon ' + tone}>
              <Icon size={20} />
            </span>
            <span>{name}</span>
            <strong>{value?.toLocaleString() ?? '—'}</strong>
          </article>
        ))}
      </div>
      {stats.error && <LoadError error={stats.error} retry={() => void stats.refetch()} />}
      <section className="panel directory" aria-labelledby="directory-title">
        <div className="section-heading">
          <div>
            <h2 id="directory-title">Employee directory</h2>
            <p>{paging ? paging.total + ' employees' : 'Employee records'}</p>
          </div>
          <button
            className="secondary"
            disabled={download.isPending}
            onClick={() => download.mutate()}
          >
            <Download size={17} /> {download.isPending ? 'Exporting…' : 'Export CSV'}
          </button>
        </div>
        {download.error && (
          <p className="error-text inset" role="alert">
            {download.error.message}
          </p>
        )}
        <div className="filters">
          <label className="search">
            <span className="sr-only">Search employees</span>
            <Search size={17} />
            <input
              type="search"
              value={input}
              maxLength={80}
              placeholder="Search name, email or ID"
              onChange={(event) => setInput(event.target.value)}
            />
          </label>
          <label>
            <span className="sr-only">Department</span>
            <select
              value={filters.department ?? ''}
              onChange={(event) => change({ department: event.target.value || undefined })}
            >
              <option value="">All departments</option>
              {stats.data?.departments.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Status</span>
            <select
              value={filters.status ?? ''}
              onChange={(event) =>
                change({ status: (event.target.value || undefined) as EmployeeStatus | undefined })
              }
            >
              <option value="">All statuses</option>
              {employeeStatuses.map((value) => (
                <option value={value} key={value}>
                  {titleCase(value)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Designation</span>
            <input
              value={filters.designation ?? ''}
              placeholder="Designation"
              maxLength={120}
              onChange={(event) => change({ designation: event.target.value || undefined })}
            />
          </label>
          <label>
            <span className="sr-only">Sort employees</span>
            <select
              value={filters.sortBy + ':' + filters.sortOrder}
              onChange={(event) => {
                const [sortBy, sortOrder] = event.target.value.split(':');
                change({ sortBy, sortOrder });
              }}
            >
              <option value="createdAt:desc">Recently added</option>
              <option value="fullName:asc">Name A–Z</option>
              <option value="fullName:desc">Name Z–A</option>
              <option value="employeeCode:asc">Employee ID</option>
              <option value="dateOfJoining:desc">Joining date</option>
            </select>
          </label>
        </div>
        {list.error ? (
          <LoadError error={list.error} retry={() => void list.refetch()} />
        ) : list.isPending ? (
          <div role="status" className="skeletons">
            <span className="sr-only">Loading employees</span>
            {[0, 1, 2, 3, 4].map((row) => (
              <div className="skeleton" key={row} />
            ))}
          </div>
        ) : !list.data.employees.length ? (
          <div className="empty">
            <Users size={28} />
            <h3>No employees found</h3>
            <p>
              {paging?.total
                ? 'Choose a previous page.'
                : 'Add an employee or adjust your filters.'}
            </p>
          </div>
        ) : (
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Employee table">
            <table aria-busy={list.isFetching}>
              <thead>
                <tr>
                  {[
                    'Employee',
                    'Employee ID',
                    'Email',
                    'Phone',
                    'Department',
                    'Designation',
                    'Status',
                    'Joined',
                    'Actions',
                  ].map((label) => (
                    <th key={label} scope="col">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.data.employees.map((employee) => (
                  <tr key={employee.id}>
                    <td>
                      <Link className="person" to={'/employees/' + employee.id}>
                        <span className="avatar">{initials(employee.fullName)}</span>
                        <strong>{employee.fullName}</strong>
                      </Link>
                    </td>
                    <td className="code">{employee.employeeCode}</td>
                    <td>{employee.email}</td>
                    <td>{employee.phone}</td>
                    <td>{employee.department}</td>
                    <td>{employee.designation}</td>
                    <td>
                      <StatusBadge status={employee.status} />
                    </td>
                    <td>{employee.dateOfJoining ?? '—'}</td>
                    <td>
                      <div className="row-actions">
                        <Link
                          to={'/employees/' + employee.id}
                          aria-label={'View ' + employee.fullName}
                        >
                          View
                        </Link>
                        <Link
                          to={'/employees/' + employee.id + '/edit'}
                          aria-label={'Edit ' + employee.fullName}
                        >
                          Edit
                        </Link>
                        <Link
                          to={'/employees/' + employee.id + '#account-access'}
                          aria-label={'Change status for ' + employee.fullName}
                        >
                          Status
                        </Link>
                      </div>
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
              onChange={(event) => change({ limit: Number(event.target.value) })}
            >
              {[10, 25, 50, 100].map((size) => (
                <option key={size}>{size}</option>
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
              disabled={(filters.page ?? 1) <= 1 || list.isFetching}
              onClick={() => setFilters((old) => ({ ...old, page: (old.page ?? 1) - 1 }))}
            >
              <ChevronLeft size={18} />
            </button>
            <button
              className="secondary icon-button"
              aria-label="Next page"
              disabled={(filters.page ?? 1) >= (paging?.totalPages ?? 1) || list.isFetching}
              onClick={() => setFilters((old) => ({ ...old, page: (old.page ?? 1) + 1 }))}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
