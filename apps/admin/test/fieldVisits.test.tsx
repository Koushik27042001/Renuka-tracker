// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import type { Visit } from '@renuka/shared';
import { FieldVisitsPage, FieldVisitDetails } from '../src/FieldVisitsPage';
import { AnalyticsDashboard, RecordedLocations } from '../src/AnalyticsDashboard';
import { analyticsApi, fieldApi } from '../src/field.api';
import { employeeApi } from '../src/api';
vi.mock('../src/EvidenceMap', () => ({
  EvidenceMap: ({ markers }: { markers: unknown[] }) => <p>{markers.length} markers</p>,
}));

const row: Visit = {
  id: '0123456789abcdef01234567',
  code: 'VIS-0123456789ABCDEF01234567',
  status: 'PENDING_REVIEW',
  visitDate: '2026-11-24',
  clientName: 'Client A',
  purpose: 'Inspect products',
  employeeId: '0123456789abcdef01234567',
  attendanceId: '0123456789abcdef01234567',
  employee: { fullName: 'Employee', employeeCode: 'EMP0001', department: 'Operations' },
};
function mount(path: string, element: React.ReactElement, pattern = path) {
  vi.spyOn(employeeApi, 'stats').mockResolvedValue({
    totalEmployees: 1,
    activeEmployees: 1,
    inactiveEmployees: 0,
    suspendedEmployees: 0,
    departments: ['Operations'],
  });
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={pattern} element={element} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('renders scoped visits and passes status and date filters to the export', async () => {
  const list = vi
    .spyOn(fieldApi, 'list')
    .mockResolvedValue({ visits: [row], total: 1, page: 1, limit: 20 });
  vi.spyOn(fieldApi, 'stats').mockResolvedValue({ total: 1, pending: 1, approved: 0, rejected: 0 });
  const csv = vi.spyOn(fieldApi, 'export').mockResolvedValue();
  mount('/visits', <FieldVisitsPage />);
  expect(await screen.findByText('Client A')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Review status'), { target: { value: 'PENDING_REVIEW' } });
  fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-11-01' } });
  await waitFor(() =>
    expect(list.mock.calls.at(-1)?.[0]).toMatchObject({
      from: '2026-11-01',
      status: 'PENDING_REVIEW',
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
  await waitFor(() =>
    expect(csv).toHaveBeenCalledWith(
      expect.objectContaining({ from: '2026-11-01', status: 'PENDING_REVIEW' }),
    ),
  );
});
it('requires the review reason and displays the resulting rejection', async () => {
  if (!HTMLDialogElement.prototype.showModal)
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
  vi.spyOn(fieldApi, 'detail').mockResolvedValue(row);
  const review = vi
    .spyOn(fieldApi, 'review')
    .mockResolvedValue({ ...row, status: 'REJECTED', reason: 'Additional evidence needed' });
  mount('/visits/' + row.id, <FieldVisitDetails />, '/visits/:id');
  fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));
  const dialog = screen.getByRole('dialog');
  expect(
    (within(dialog).getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.change(within(dialog).getByLabelText('Rejection reason'), {
    target: { value: 'Additional evidence needed' },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
  expect(await screen.findByText('Rejection reason: Additional evidence needed')).toBeTruthy();
  expect(review).toHaveBeenCalledWith(row.id, 'reject', 'Additional evidence needed');
});
it('renders empty charts without inventing attendance or visits', async () => {
  vi.spyOn(analyticsApi, 'overview').mockResolvedValue({
    from: '2026-11-01',
    to: '2026-11-24',
    timezone: 'Asia/Kolkata',
    departments: [],
    totalEmployees: 0,
    activeEmployees: 0,
    currentlyCheckedIn: 0,
    completedAttendanceToday: 0,
    totalVisits: 0,
    visitsToday: 0,
    pendingReviews: 0,
    approvedVisits: 0,
    rejectedVisits: 0,
    averageWorkingHours: null,
    totalWorkingMinutes: 0,
  });
  vi.spyOn(analyticsApi, 'visits').mockResolvedValue({ trend: [], total: null, byDepartment: [] });
  vi.spyOn(analyticsApi, 'attendance').mockResolvedValue({
    trend: [],
    total: null,
    byDepartment: [],
  });
  vi.spyOn(analyticsApi, 'reviews').mockResolvedValue({
    pending: 0,
    approved: 0,
    rejected: 0,
    averageReviewHours: null,
  });
  vi.spyOn(analyticsApi, 'employees').mockResolvedValue({
    employees: [],
    total: 0,
    page: 1,
    limit: 20,
  });
  mount('/reports', <AnalyticsDashboard />);
  expect(await screen.findAllByText('No records in this period.')).toHaveLength(6);
});
it('requests only filtered recorded locations and handles an empty response', async () => {
  const map = vi
    .spyOn(analyticsApi, 'locations')
    .mockResolvedValue({ markers: [], total: 0, page: 1, limit: 250 });
  mount('/reports/locations', <RecordedLocations />);
  expect(await screen.findByText('0 markers')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Review status'), { target: { value: 'APPROVED' } });
  await waitFor(() =>
    expect(map.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'APPROVED', page: 1 }),
  );
});
