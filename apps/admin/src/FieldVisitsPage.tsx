import { useEffect, useState, type FormEvent } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Download, MapPin } from 'lucide-react';
import type { Visit, VisitStatus } from '@renuka/shared';
import { employeeApi } from './api';
import { LoadError } from './EmployeesPage';
import { Modal } from './EmployeeProfile';
import { fieldApi, type FieldFilters } from './field.api';
import { EvidenceMap } from './EvidenceMap';

export const stateLabels: Record<VisitStatus, string> = {
  DRAFT: 'Draft',
  PENDING_REVIEW: 'Pending review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};
const tone: Record<VisitStatus, string> = {
  DRAFT: 'inactive',
  PENDING_REVIEW: 'suspended',
  APPROVED: 'active',
  REJECTED: 'suspended',
};
const badge = (status: VisitStatus) => (
  <span className={'badge ' + tone[status]}>{stateLabels[status]}</span>
);

export function FieldFiltersBar({
  value,
  onChange,
  clients = false,
  analytics = false,
}: {
  value: FieldFilters;
  onChange: (update: Partial<FieldFilters>) => void;
  clients?: boolean;
  analytics?: boolean;
}) {
  const departments = useQuery({
    queryKey: ['employees', 'stats'],
    queryFn: ({ signal }) => employeeApi.stats(signal),
  });
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [prefix, setPrefix] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setPrefix(employeeSearch.trim()), 250);
    return () => clearTimeout(timer);
  }, [employeeSearch]);
  const employees = useQuery({
    queryKey: ['employees', 'filter', prefix, value.department],
    enabled: !!prefix,
    queryFn: ({ signal }) =>
      employeeApi.list({ search: prefix, department: value.department, limit: 15 }, signal),
  });
  return (
    <div className="filters attendance-filters">
      <label>
        From
        <input
          type="date"
          value={value.from ?? ''}
          onChange={(e) => onChange({ from: e.target.value || undefined })}
        />
      </label>
      <label>
        To
        <input
          type="date"
          value={value.to ?? ''}
          onChange={(e) => onChange({ to: e.target.value || undefined })}
        />
      </label>
      <label>
        Department
        <select
          value={value.department ?? ''}
          onChange={(e) =>
            onChange({ department: e.target.value || undefined, employeeId: undefined })
          }
        >
          <option value="">All departments</option>
          {departments.data?.departments.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </label>
      <label>
        Find employee
        <input
          type="search"
          maxLength={80}
          placeholder="Name or employee ID"
          value={employeeSearch}
          onChange={(e) => setEmployeeSearch(e.target.value)}
        />
      </label>
      {(prefix || value.employeeId) && (
        <label>
          Employee
          <select
            value={value.employeeId ?? ''}
            onChange={(e) => onChange({ employeeId: e.target.value || undefined })}
          >
            <option value="">All employees</option>
            {!!value.employeeId &&
              !employees.data?.employees.some((user) => user.id === value.employeeId) && (
                <option value={value.employeeId}>Selected employee</option>
              )}
            {employees.data?.employees.map((user) => (
              <option value={user.id} key={user.id}>
                {user.employeeCode} · {user.fullName}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Review status
        <select
          value={value.status ?? ''}
          onChange={(e) =>
            onChange({ status: (e.target.value || undefined) as VisitStatus | undefined })
          }
        >
          <option value="">All statuses</option>
          {(['PENDING_REVIEW', 'APPROVED', 'REJECTED'] as const).map((status) => (
            <option value={status} key={status}>
              {stateLabels[status]}
            </option>
          ))}
        </select>
      </label>
      {clients && (
        <label>
          Client or place
          <input
            type="search"
            maxLength={120}
            value={value.client ?? ''}
            onChange={(e) => onChange({ client: e.target.value || undefined })}
          />
        </label>
      )}
      {analytics && (
        <label>
          Group by
          <select
            value={value.interval ?? 'day'}
            onChange={(e) => onChange({ interval: e.target.value as FieldFilters['interval'] })}
          >
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
          </select>
        </label>
      )}
    </div>
  );
}
export function Pages({
  page,
  total,
  limit,
  onPage,
}: {
  page: number;
  total: number;
  limit: number;
  onPage: (page: number) => void;
}) {
  return (
    <div className="pagination">
      <span>
        Page {page} of {Math.max(1, Math.ceil(total / limit))}
      </span>
      <div>
        <button className="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <button
          className="secondary"
          disabled={page * limit >= total}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
export function EvidencePhoto({ id }: { id: string }) {
  const result = useQuery({
    queryKey: ['evidence-image', id],
    queryFn: ({ signal }) => fieldApi.image(id, signal),
    gcTime: 0,
  });
  const [source, setSource] = useState('');
  useEffect(() => {
    if (!result.data) {
      setSource('');
      return;
    }
    const url = URL.createObjectURL(result.data);
    setSource(url);
    return () => URL.revokeObjectURL(url);
  }, [result.data]);
  return result.error ? (
    <LoadError error={result.error} retry={() => void result.refetch()} />
  ) : source ? (
    <img
      className="evidence-photo"
      src={source}
      alt="Submitted GPS selfie with permanent watermark"
    />
  ) : (
    <p role="status">Loading private evidence…</p>
  );
}

export function FieldVisitsPage({ evidenceMode = false }: { evidenceMode?: boolean }) {
  const [params] = useSearchParams();
  const [filters, setFilters] = useState<FieldFilters>(() => ({
    page: 1,
    limit: 20,
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
    department: params.get('department') ?? undefined,
    status: ['PENDING_REVIEW', 'APPROVED', 'REJECTED'].includes(params.get('status') ?? '')
      ? (params.get('status') as VisitStatus)
      : undefined,
    employeeId: /^[a-f0-9]{24}$/i.test(params.get('employeeId') ?? '')
      ? params.get('employeeId')!
      : undefined,
  }));
  const [client, setClient] = useState('');
  const [preview, setPreview] = useState<Visit>();
  useEffect(() => {
    const timer = setTimeout(
      () => setFilters((value) => ({ ...value, client: client.trim() || undefined, page: 1 })),
      300,
    );
    return () => clearTimeout(timer);
  }, [client]);
  const invalid = !!(filters.from && filters.to && filters.to < filters.from);
  const rows = useQuery({
    queryKey: ['field-visits', filters],
    queryFn: ({ signal }) => fieldApi.list(filters, signal),
    enabled: !invalid,
    placeholderData: keepPreviousData,
  });
  const range = { ...filters, page: undefined, limit: undefined, status: undefined };
  const stats = useQuery({
    queryKey: ['field-visits', 'stats', range],
    queryFn: ({ signal }) => fieldApi.stats(range, signal),
    enabled: !invalid,
  });
  const download = useMutation({
    mutationFn: () => fieldApi.export({ ...filters, page: undefined, limit: undefined }),
  });
  const titles = evidenceMode
    ? [
        'Evidence ID',
        'Visit',
        'Employee',
        'Client or place',
        'Captured',
        'Coordinates',
        'Accuracy',
        'Review status',
        'Actions',
      ]
    : [
        'Visit',
        'Employee ID',
        'Employee',
        'Client or place',
        'Date',
        'Location',
        'Evidence',
        'Status',
        'Actions',
      ];
  return (
    <>
      <header className="page-heading">
        <div>
          <h1>{evidenceMode ? 'Visit evidence' : 'Field Visit Management'}</h1>
          <p>Review employee-submitted field visits and GPS selfie evidence.</p>
        </div>
        <div className="row-actions">
          <Link className="secondary" to={evidenceMode ? '/visits' : '/visits/evidence'}>
            {evidenceMode ? 'Visit list' : 'Evidence table'}
          </Link>
          <button
            className="secondary"
            disabled={invalid || download.isPending}
            onClick={() => download.mutate()}
          >
            <Download size={16} />
            Export CSV
          </button>
        </div>
      </header>
      {download.error && (
        <p role="alert" className="error-text">
          {download.error.message}
        </p>
      )}
      {stats.error && <LoadError error={stats.error} retry={() => void stats.refetch()} />}
      <div className="summary-grid">
        {[
          ['Total visits', stats.data?.total],
          ['Pending review', stats.data?.pending],
          ['Approved visits', stats.data?.approved],
          ['Rejected visits', stats.data?.rejected],
        ].map(([label, count]) => (
          <article className="panel stat" key={label}>
            <span>{label}</span>
            <strong>{count ?? '—'}</strong>
          </article>
        ))}
      </div>
      <section className="panel directory">
        <FieldFiltersBar
          value={{ ...filters, client }}
          onChange={(next) => {
            if ('client' in next) setClient(next.client ?? '');
            else setFilters((old) => ({ ...old, ...next, page: 1 }));
          }}
          clients
        />
        {invalid ? (
          <p role="alert" className="notice">
            End date must be on or after start date.
          </p>
        ) : rows.error ? (
          <LoadError error={rows.error} retry={() => void rows.refetch()} />
        ) : rows.isPending ? (
          <p role="status" className="profile-panel">
            Loading visits…
          </p>
        ) : !rows.data.visits.length ? (
          <div className="empty">
            <p>No visits match these filters.</p>
          </div>
        ) : (
          <>
            <div className="table-scroll" tabIndex={0} role="region" aria-label="Field visit table">
              <table>
                <thead>
                  <tr>
                    {titles.map((title) => (
                      <th scope="col" key={title}>
                        {title}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.data.visits.map((row) => (
                    <tr key={row.id}>
                      {evidenceMode ? (
                        <>
                          <td>{row.evidence?.id ?? '—'}</td>
                          <td>{row.code}</td>
                          <td>{row.employee?.fullName}</td>
                          <td>{row.clientName}</td>
                          <td>
                            {row.evidence
                              ? new Date(row.evidence.capturedAt).toLocaleString()
                              : '—'}
                          </td>
                          <td>
                            {row.evidence
                              ? row.evidence.latitude.toFixed(6) +
                                ', ' +
                                row.evidence.longitude.toFixed(6)
                              : '—'}
                          </td>
                          <td>
                            {row.evidence ? '±' + Math.round(row.evidence.accuracy) + ' m' : '—'}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="code">{row.code}</td>
                          <td>{row.employee?.employeeCode}</td>
                          <td>{row.employee?.fullName}</td>
                          <td>{row.clientName}</td>
                          <td>{row.visitDate}</td>
                          <td className="field-address">
                            {row.evidence?.address ?? 'Address unavailable'}
                          </td>
                          <td>
                            {row.evidence ? (
                              <button className="secondary" onClick={() => setPreview(row)}>
                                Preview
                              </button>
                            ) : (
                              'Unavailable'
                            )}
                          </td>
                        </>
                      )}
                      <td>{badge(row.status)}</td>
                      <td>
                        <div className="row-actions">
                          {evidenceMode && row.evidence && (
                            <button className="secondary" onClick={() => setPreview(row)}>
                              Preview
                            </button>
                          )}
                          <Link to={'/visits/' + row.id}>View</Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pages
              page={filters.page ?? 1}
              total={rows.data.total}
              limit={rows.data.limit}
              onPage={(page) => setFilters((old) => ({ ...old, page }))}
            />
          </>
        )}
      </section>
      {preview?.evidence && (
        <Modal title="Visit evidence" close={() => setPreview(undefined)}>
          <div className="dialog-form">
            <EvidencePhoto id={preview.evidence.id} />
            <Link className="secondary" to={'/visits/' + preview.id}>
              Open visit
            </Link>
            <button className="secondary" onClick={() => setPreview(undefined)}>
              Close
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

export function FieldVisitDetails() {
  const { id = '' } = useParams();
  const cache = useQueryClient();
  const result = useQuery({
    queryKey: ['field-visit', id],
    queryFn: ({ signal }) => fieldApi.detail(id, signal),
  });
  const [action, setAction] = useState<'approve' | 'reject'>();
  const [reason, setReason] = useState('');
  const row = result.data;
  const review = useMutation({
    mutationFn: () => fieldApi.review(id, action!, reason),
    onSuccess: (saved) => {
      cache.setQueryData(['field-visit', id], saved);
      setAction(undefined);
      void cache.invalidateQueries({ queryKey: ['field-visits'] });
      void cache.invalidateQueries({ queryKey: ['analytics'] });
    },
  });
  const verify = useMutation({ mutationFn: () => fieldApi.verify(row!.evidence!.id) });
  function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    review.mutate();
  }
  const evidence = row?.evidence;
  return (
    <>
      <header className="page-heading">
        <div>
          <Link className="back-link" to="/visits">
            Back to field visits
          </Link>
          <h1>{row?.clientName ?? 'Visit details'}</h1>
          {row && (
            <p>
              {row.code} · {row.visitDate}
            </p>
          )}
        </div>
        {row && badge(row.status)}
      </header>
      {result.error ? (
        <LoadError error={result.error} retry={() => void result.refetch()} />
      ) : !row ? (
        <p role="status">Loading visit…</p>
      ) : (
        <>
          <section className="panel profile-panel">
            <h2>Visit details</h2>
            <p>
              {row.employee?.fullName} · {row.employee?.employeeCode} · {row.employee?.department}
            </p>
            <p>{row.purpose}</p>
            {row.contactName && (
              <p>
                Contact {row.contactName} {row.contactPhone}
              </p>
            )}
            {!row.contactName && row.contactPhone && <p>Contact {row.contactPhone}</p>}
            {row.remarks && <p>{row.remarks}</p>}
            {row.notes && <p>{row.notes}</p>}
            {row.submittedAt && <p>Submitted {new Date(row.submittedAt).toLocaleString()}</p>}
            {row.reviewedAt && (
              <p>
                Reviewed {new Date(row.reviewedAt).toLocaleString()} · Reviewer {row.reviewedBy}
              </p>
            )}
            {row.reason && <p>Rejection reason: {row.reason}</p>}
          </section>
          <div className="field-detail-grid">
            <section className="panel profile-panel">
              <h2>Submitted selfie</h2>
              {evidence?.enhancedReview && (
                <p role="status">
                  Offline capture requires enhanced review. The reported capture time comes from the
                  employee device.
                  {evidence.syncDelaySeconds !== undefined &&
                    ' The server received the upload ' +
                      Math.round(evidence.syncDelaySeconds / 60) +
                      ' minutes after that time.'}
                </p>
              )}
              {evidence ? <EvidencePhoto id={evidence.id} /> : <p>Evidence unavailable.</p>}
            </section>
            <section className="panel profile-panel">
              <h2>
                <MapPin size={16} /> Recorded location
              </h2>
              {evidence ? (
                <>
                  <p>{evidence.address ?? 'Address unavailable'}</p>
                  <p>
                    {evidence.latitude.toFixed(6)}, {evidence.longitude.toFixed(6)} · GPS ±
                    {Math.round(evidence.accuracy)} m
                  </p>
                  <p>Captured {new Date(evidence.capturedAt).toLocaleString()}</p>
                  <p>
                    {evidence.width} × {evidence.height} · {Math.ceil(evidence.size / 1024)} KB ·
                    Watermark v{evidence.watermarkVersion}
                  </p>
                  {evidence.mockLocation && (
                    <p role="status">The device reported a mock-location indicator.</p>
                  )}
                  <button
                    className="secondary"
                    disabled={verify.isPending}
                    onClick={() => verify.mutate()}
                  >
                    Verify stored image hash
                  </button>
                  {verify.data && (
                    <p role="status">
                      {verify.data.matches
                        ? 'Stored image matches its recorded SHA-256 hash.'
                        : 'Stored image differs from its recorded hash.'}
                    </p>
                  )}
                  {verify.error && (
                    <p role="alert" className="error-text">
                      {verify.error.message}
                    </p>
                  )}
                  <EvidenceMap
                    markers={[
                      {
                        id: row.id,
                        code: row.code,
                        clientName: row.clientName,
                        visitDate: row.visitDate,
                        status: row.status,
                        latitude: evidence.latitude,
                        longitude: evidence.longitude,
                        employee: row.employee?.fullName,
                      },
                    ]}
                  />
                </>
              ) : (
                <p>No recorded GPS point.</p>
              )}
            </section>
          </div>
          {row.status === 'PENDING_REVIEW' && (
            <section className="panel profile-panel">
              <h2>Review decision</h2>
              <p>Approval records acceptance under company policy.</p>
              <div className="row-actions">
                <button
                  className="primary"
                  onClick={() => {
                    review.reset();
                    setReason('');
                    setAction('approve');
                  }}
                >
                  Approve
                </button>
                <button
                  className="secondary danger"
                  onClick={() => {
                    review.reset();
                    setReason('');
                    setAction('reject');
                  }}
                >
                  Reject
                </button>
              </div>
            </section>
          )}
          {action && (
            <Modal
              title={action === 'approve' ? 'Approve this visit?' : 'Reject this visit?'}
              close={() => {
                if (!review.isPending) setAction(undefined);
              }}
            >
              <form className="dialog-form" onSubmit={confirm}>
                {action === 'reject' && (
                  <label>
                    Rejection reason
                    <textarea
                      required
                      minLength={3}
                      maxLength={240}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                )}
                {review.error && (
                  <p role="alert" className="error-text">
                    {review.error.message}
                  </p>
                )}
                <div className="form-actions">
                  <button
                    type="button"
                    className="secondary"
                    disabled={review.isPending}
                    onClick={() => setAction(undefined)}
                  >
                    Cancel
                  </button>
                  <button
                    className="primary"
                    disabled={review.isPending || (action === 'reject' && reason.trim().length < 3)}
                  >
                    Confirm
                  </button>
                </div>
              </form>
            </Modal>
          )}
        </>
      )}
    </>
  );
}
