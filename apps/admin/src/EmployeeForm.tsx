import { useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom';
import { employeeProfileInput, type Employee, type EmployeeInput } from '@renuka/shared';
import { ApiError, employeeApi } from './api';
import { LoadError } from './EmployeesPage';
import { useSession } from './session';

const fields = [
  { name: 'fullName', label: 'Full name' },
  { name: 'email', label: 'Email address', type: 'email' },
  { name: 'phone', label: 'Phone number', type: 'tel' },
  { name: 'department', label: 'Department' },
  { name: 'designation', label: 'Designation' },
  { name: 'dateOfJoining', label: 'Date of joining', type: 'date' },
] as const;

export function EmployeeForm({ employee }: { employee?: Employee }) {
  const user = useSession();
  const query = useQueryClient();
  const navigate = useNavigate();
  const allowLeave = useRef(false);
  const initialRevision = useRef(employee?.revision ?? 0);
  const form = useForm<EmployeeInput>({
    resolver: zodResolver(employeeProfileInput),
    defaultValues: {
      fullName: employee?.fullName ?? '',
      email: employee?.email ?? '',
      phone: employee?.phone ?? '',
      department: employee?.department ?? (user?.role === 'ADMIN' ? user.department : ''),
      designation: employee?.designation ?? '',
      dateOfJoining: employee?.dateOfJoining ?? '',
    },
  });
  const { isDirty, isSubmitting, errors } = form.formState;
  const blocker = useBlocker(() => isDirty && !allowLeave.current);
  useEffect(() => {
    if (blocker.state === 'blocked') {
      if (window.confirm('Discard your unsaved changes?')) blocker.proceed();
      else blocker.reset();
    }
  }, [blocker]);
  useEffect(() => {
    if (!isDirty) return;
    const warning = (event: BeforeUnloadEvent) => {
      if (!allowLeave.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warning);
    return () => window.removeEventListener('beforeunload', warning);
  }, [isDirty]);

  async function submit(input: EmployeeInput) {
    try {
      const saved = employee
        ? await employeeApi.update(employee.id, { ...input, revision: initialRevision.current })
        : await employeeApi.create(input);
      await query.invalidateQueries({ queryKey: ['employees'] });
      form.reset();
      allowLeave.current = true;
      navigate('/employees/' + saved.id, {
        state: {
          notice: employee
            ? 'Employee profile updated.'
            : 'Employee created. Issue an activation link to complete onboarding.',
        },
      });
    } catch (error) {
      if (error instanceof ApiError) {
        for (const item of error.errors) {
          const match = fields.find((field) => field.name === item.field);
          if (match) form.setError(match.name, { message: item.message });
        }
      }
      form.setError('root', {
        message: error instanceof Error ? error.message : 'Employee could not be saved.',
      });
    }
  }
  const back = employee ? '/employees/' + employee.id : '/employees';
  return (
    <>
      <header className="page-heading">
        <div>
          <Link className="back-link" to={back}>
            Back to {employee ? 'profile' : 'employees'}
          </Link>
          <h1>{employee ? 'Edit employee' : 'Add employee'}</h1>
          <p>
            {employee
              ? employee.employeeCode + ' · Employee'
              : 'Create an employee profile and start onboarding.'}
          </p>
        </div>
      </header>
      <form className="panel form-panel" onSubmit={form.handleSubmit(submit)} noValidate>
        <h2>Employee details</h2>
        <div className="form-grid">
          {fields.map((field) => (
            <div className="form-field" key={field.name}>
              <label htmlFor={field.name}>{field.label}</label>
              {field.name === 'dateOfJoining' && <small>Optional</small>}
              <input
                id={field.name}
                type={'type' in field ? field.type : 'text'}
                readOnly={field.name === 'department' && user?.role === 'ADMIN'}
                aria-invalid={!!errors[field.name]}
                aria-describedby={errors[field.name] ? field.name + '-error' : undefined}
                {...form.register(field.name)}
              />
              {errors[field.name]?.message && (
                <small id={field.name + '-error'} className="error-text" role="alert">
                  {errors[field.name]?.message}
                </small>
              )}
            </div>
          ))}
        </div>
        {errors.root?.message && (
          <p role="alert" className="error-text">
            {errors.root.message}
          </p>
        )}
        <div className="form-actions">
          <Link className="secondary" to={back}>
            Cancel
          </Link>
          <button className="primary" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : employee ? 'Save changes' : 'Create employee'}
          </button>
        </div>
      </form>
    </>
  );
}

export function EditEmployee() {
  const { id = '' } = useParams();
  const employee = useQuery({
    queryKey: ['employees', 'detail', id],
    queryFn: ({ signal }) => employeeApi.detail(id, signal),
  });
  if (employee.isPending) return <p role="status">Loading employee…</p>;
  if (employee.error)
    return <LoadError error={employee.error} retry={() => void employee.refetch()} />;
  return employee.data ? <EmployeeForm key={employee.data.id} employee={employee.data} /> : null;
}
