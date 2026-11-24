// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { MemoryRouter, createMemoryRouter, RouterProvider, Outlet } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Employee } from '@renuka/shared';
import { EmployeesPage } from '../src/EmployeesPage';
import { EmployeeForm, EditEmployee } from '../src/EmployeeForm';
import { EmployeeProfile } from '../src/EmployeeProfile';
import { employeeApi, ApiError } from '../src/api';
import { Protected, SessionProvider } from '../src/session';

const employee: Employee = {
  id: '123456789012345678901234',
  employeeCode: 'EMP0001',
  fullName: 'Ravi Worker',
  email: 'ravi@example.test',
  phone: '+919876543210',
  designation: 'Technician',
  department: 'Operations',
  role: 'EMPLOYEE',
  status: 'ACTIVE',
  revision: 0,
  onboardingPending: false,
  dateOfJoining: '2026-11-24',
  lastLoginAt: null,
  createdAt: '2026-11-24T12:30:00Z',
  updatedAt: '2026-11-24T12:30:00Z',
};
const stats = {
  totalEmployees: 15,
  activeEmployees: 10,
  inactiveEmployees: 3,
  suspendedEmployees: 2,
  departments: ['Operations'],
};
const makeClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
const result = (rows: Employee[], page = 1, total = 15) => ({
  employees: rows,
  pagination: { page, limit: 10, total, totalPages: Math.ceil(total / 10) },
});
function renderPage() {
  return render(
    <QueryClientProvider client={makeClient()}>
      <MemoryRouter>
        <EmployeesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
function renderRoutes(initial: string, element: React.ReactElement) {
  const router = createMemoryRouter(
    [
      { path: '/login', element: <h1>Admin sign in</h1> },
      { path: '/employees', element: <h1>Employee directory</h1> },
      { path: '/employees/new', element },
      { path: '/employees/:id/edit', element },
      {
        path: '/employees/:id',
        element:
          initial.endsWith('edit') || initial.endsWith('new') ? <h1>Employee saved</h1> : element,
      },
    ],
    { initialEntries: [initial] },
  );
  return render(
    <QueryClientProvider client={makeClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
  }
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('renders the loading skeleton, table and real summary values with scrollable table semantics', async () => {
  let resolve!: (value: ReturnType<typeof result>) => void;
  vi.spyOn(employeeApi, 'list').mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  vi.spyOn(employeeApi, 'stats').mockResolvedValue(stats);
  renderPage();
  expect(screen.getByText('Loading employees')).toBeTruthy();
  await act(async () => resolve(result([employee])));
  expect(
    within(await screen.findByRole('region', { name: 'Employee table' })).getByText(
      employee.fullName,
    ),
  ).toBeTruthy();
  expect(screen.getByText('15 employees')).toBeTruthy();
});

it('searches, filters, paginates, and exports the current filters', async () => {
  const list = vi
    .spyOn(employeeApi, 'list')
    .mockImplementation(async (filters) => result([employee], filters.page));
  vi.spyOn(employeeApi, 'stats').mockResolvedValue(stats);
  const download = vi.spyOn(employeeApi, 'export').mockResolvedValue();
  renderPage();
  await screen.findByText(employee.fullName);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Ravi' } });
  await waitFor(() => expect(list.mock.calls.at(-1)?.[0].search).toBe('Ravi'));
  await screen.findByRole('option', { name: 'Operations' });
  fireEvent.change(screen.getByLabelText('Department'), { target: { value: 'Operations' } });
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'ACTIVE' } });
  await waitFor(() =>
    expect(list.mock.calls.at(-1)?.[0]).toMatchObject({
      department: 'Operations',
      status: 'ACTIVE',
    }),
  );
  const next = screen.getByRole<HTMLButtonElement>('button', { name: 'Next page' });
  await waitFor(() => expect(next.disabled).toBe(false));
  fireEvent.click(next);
  await waitFor(() => expect(list.mock.calls.at(-1)?.[0].page).toBe(2));
  fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
  await waitFor(() =>
    expect(download).toHaveBeenCalledWith(
      expect.objectContaining({ department: 'Operations', search: 'Ravi' }),
    ),
  );
  expect(download.mock.calls[0][0]).not.toHaveProperty('page');
});

it('shows an API error and recovers to the empty state', async () => {
  vi.spyOn(employeeApi, 'list')
    .mockRejectedValueOnce(new Error('Connection lost'))
    .mockResolvedValue(result([], 1, 0));
  vi.spyOn(employeeApi, 'stats').mockResolvedValue(stats);
  renderPage();
  expect(await screen.findByRole('alert')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('No employees found')).toBeTruthy();
});

it('validates new forms, displays duplicate email errors, and navigates after creation', async () => {
  const create = vi
    .spyOn(employeeApi, 'create')
    .mockRejectedValueOnce(
      new ApiError(409, 'Email already registered', [
        { field: 'email', message: 'Use another email' },
      ]),
    )
    .mockResolvedValue(employee);
  renderRoutes('/employees/new', <EmployeeForm />);
  const submit = screen.getByRole('button', { name: 'Create employee' });
  fireEvent.click(submit);
  expect(await screen.findAllByRole('alert')).not.toHaveLength(0);
  expect(create).not.toHaveBeenCalled();
  for (const [label, value] of [
    ['Full name', employee.fullName],
    ['Email address', employee.email],
    ['Phone number', employee.phone],
    ['Department', employee.department],
    ['Designation', employee.designation],
  ]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.click(submit);
  expect(await screen.findByText('Use another email')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Email address'), {
    target: { value: 'available@example.test' },
  });
  fireEvent.click(submit);
  expect(await screen.findByRole('heading', { name: 'Employee saved' })).toBeTruthy();
});

it('prefills edits and sends the revision with allowed fields', async () => {
  vi.spyOn(employeeApi, 'detail').mockResolvedValue(employee);
  const update = vi
    .spyOn(employeeApi, 'update')
    .mockResolvedValue({ ...employee, designation: 'Lead' });
  renderRoutes('/employees/' + employee.id + '/edit', <EditEmployee />);
  expect(((await screen.findByLabelText('Designation')) as HTMLInputElement).value).toBe(
    employee.designation,
  );
  fireEvent.change(screen.getByLabelText('Designation'), { target: { value: 'Lead' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() =>
    expect(update).toHaveBeenCalledWith(
      employee.id,
      expect.objectContaining({ revision: 0, designation: 'Lead' }),
    ),
  );
  expect(update.mock.calls[0][1]).not.toHaveProperty('status');
});

it('displays the employee profile and confirms status changes with a reason', async () => {
  vi.spyOn(employeeApi, 'detail').mockResolvedValue(employee);
  const status = vi
    .spyOn(employeeApi, 'status')
    .mockResolvedValue({ ...employee, status: 'INACTIVE' });
  renderRoutes('/employees/' + employee.id, <EmployeeProfile />);
  expect(await screen.findByText(employee.email)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Deactivate account' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText(/sessions will be revoked/)).toBeTruthy();
  fireEvent.change(within(dialog).getByLabelText('Reason'), {
    target: { value: 'Contract ended' },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
  await waitFor(() =>
    expect(status).toHaveBeenCalledWith(employee.id, {
      status: 'INACTIVE',
      reason: 'Contract ended',
      revision: 0,
    }),
  );
  expect(await screen.findByText('Account status updated.')).toBeTruthy();
});

it('redirects expired or missing administrator sessions to sign-in', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ message: 'Authentication failed' }), { status: 401 }),
    ),
  );
  const router = createMemoryRouter(
    [
      {
        element: (
          <SessionProvider>
            <Outlet />
          </SessionProvider>
        ),
        children: [
          {
            path: '/employees',
            element: (
              <Protected>
                <h1>Private employee directory</h1>
              </Protected>
            ),
          },
          { path: '/login', element: <h1>Admin sign in</h1> },
        ],
      },
    ],
    { initialEntries: ['/employees'] },
  );
  render(
    <QueryClientProvider client={makeClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  expect(await screen.findByRole('heading', { name: 'Admin sign in' })).toBeTruthy();
  expect(screen.queryByText('Private employee directory')).toBeNull();
});
