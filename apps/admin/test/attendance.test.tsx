// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AttendanceDetails, AttendancePage } from '../src/AttendancePage';
import { attendanceApi } from '../src/attendance.api';

const shift = {
  id: '0123456789abcdef01234567',
  employeeId: '0123456789abcdef01234567',
  attendanceDate: '2026-11-24',
  timezone: 'Asia/Kolkata',
  checkInTime: '2026-11-24T02:30:00Z',
  checkOutTime: null,
  workingMinutes: null,
  status: 'CHECKED_IN' as const,
  employee: { employeeCode: 'EMP0001', fullName: 'Ravi Worker', department: 'Operations' },
};
const stats = {
  totalEmployees: 77,
  currentlyOnDuty: 1,
  checkedOutToday: 14,
  notCheckedInToday: 4,
  incompleteSessions: 2,
  attendanceDate: shift.attendanceDate,
  timezone: shift.timezone,
  departments: ['Operations'],
};
const listResult = {
  records: [shift],
  pagination: { page: 1, limit: 20, total: 24, totalPages: 2 },
};
function mount(path = '/attendance') {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/attendance" element={<AttendancePage />} />
          <Route path="/attendance/:id" element={<AttendanceDetails />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('loads server counts and rows, filters, searches, paginates and exports without pagination', async () => {
  const list = vi.spyOn(attendanceApi, 'list').mockResolvedValue(listResult);
  vi.spyOn(attendanceApi, 'stats').mockResolvedValue(stats);
  const csv = vi.spyOn(attendanceApi, 'export').mockResolvedValue();
  mount();
  expect(screen.getByText('Loading attendance')).toBeTruthy();
  expect(await screen.findByText('Ravi Worker')).toBeTruthy();
  expect(await screen.findByText('77')).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Ravi' } });
  await waitFor(() => expect(list.mock.calls.at(-1)?.[0].search).toBe('Ravi'));
  await screen.findByRole('option', { name: 'Operations' });
  fireEvent.change(screen.getByLabelText('Department'), { target: { value: 'Operations' } });
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'CHECKED_IN' } });
  await waitFor(() =>
    expect(list.mock.calls.at(-1)?.[0]).toMatchObject({
      department: 'Operations',
      status: 'CHECKED_IN',
    }),
  );
  const next = screen.getByRole<HTMLButtonElement>('button', { name: 'Next page' });
  await waitFor(() => expect(next.disabled).toBe(false));
  fireEvent.click(next);
  await waitFor(() => expect(list.mock.calls.at(-1)?.[0].page).toBe(2));
  fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
  await waitFor(() =>
    expect(csv).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'Ravi', department: 'Operations' }),
    ),
  );
  expect(csv.mock.calls[0][0]).not.toHaveProperty('page');
});

it('renders GPS details only on the detail route and includes the captured map point', async () => {
  vi.spyOn(attendanceApi, 'detail').mockResolvedValue({
    ...shift,
    checkInLocation: {
      latitude: 22.57,
      longitude: 88.36,
      accuracy: 15,
      capturedAt: shift.checkInTime,
    },
  });
  mount('/attendance/' + shift.id);
  expect(await screen.findByText(/22.570000, 88.360000/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Open in Maps' }).getAttribute('href')).toContain(
    '22.57%2C88.36',
  );
});

it('shows a forbidden response without displaying attendance rows', async () => {
  vi.spyOn(attendanceApi, 'list').mockRejectedValue(new Error('Access denied'));
  vi.spyOn(attendanceApi, 'stats').mockResolvedValue(stats);
  mount();
  expect(await screen.findByText('Access denied')).toBeTruthy();
  expect(screen.queryByRole('region', { name: 'Attendance table' })).toBeNull();
});
