import { useEffect, useState, type ReactNode } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { AlertCircle, CheckCircle2, Download, LoaderCircle, RefreshCw } from 'lucide-react';

export function Brand() {
  return (
    <div className="brand">
      <img src="/mark.svg" alt="" />
      <div>
        <strong>Renuka</strong>
        <span>FieldForce</span>
      </div>
    </div>
  );
}
export function Title({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}
export function Alert({ error }: { error: string }) {
  return error ? (
    <div className="alert" role="alert">
      <AlertCircle size={19} />
      {error}
    </div>
  ) : null;
}
export const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Try again.';
export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <LoaderCircle size={20} className="spin" />
      {label}
    </div>
  );
}
export function useResource<T>(load: () => Promise<T>, deps: readonly unknown[]) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    setData(undefined);
    setError('');
    void load().then(
      (value) => {
        if (live) setData(value);
      },
      (problem) => {
        if (live) setError(message(problem));
      },
    );
    return () => {
      live = false;
    };
    // Loaders are bound to the supplied resource keys.
  }, [...deps, version]);
  return { data, error, refresh: () => setVersion((value) => value + 1) };
}
export function Resource<T>({
  state,
  children,
}: {
  state: ReturnType<typeof useResource<T>>;
  children: (data: T) => ReactNode;
}) {
  if (state.error)
    return (
      <div className="stack">
        <Alert error={state.error} />
        <button className="button secondary" onClick={state.refresh}>
          Try again
        </button>
      </div>
    );
  if (state.data === undefined) return <Loading />;
  return children(state.data);
}
export function Pill({ value }: { value: string }) {
  return (
    <span className={'pill ' + value.toLowerCase()}>
      {value.replaceAll('_', ' ').toLowerCase()}
    </span>
  );
}
export function formatTime(value?: string | null, timezone?: string) {
  return value
    ? new Intl.DateTimeFormat('en-IN', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: timezone,
      }).format(new Date(value))
    : '—';
}
export function formatDuration(minutes: number | null | undefined) {
  if (minutes == null) return '—';
  return Math.floor(minutes / 60) + 'h ' + (minutes % 60).toString().padStart(2, '0') + 'm';
}
export function Pager({
  page,
  hasNext,
  setPage,
}: {
  page: number;
  hasNext: boolean;
  setPage: (page: number) => void;
}) {
  return (
    <div className="pager">
      <button className="button secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>
        Previous
      </button>
      <span>Page {page}</span>
      <button className="button secondary" disabled={!hasNext} onClick={() => setPage(page + 1)}>
        Next
      </button>
    </div>
  );
}
type InstallEvent = Event & {
  prompt(): Promise<unknown>;
  userChoice: Promise<{ outcome: string }>;
};
export function useInstall() {
  const [prompt, setPrompt] = useState<InstallEvent | null>(null);
  const [installed, setInstalled] = useState(
    () =>
      matchMedia('(display-mode: standalone)').matches ||
      !!(navigator as Navigator & { standalone?: boolean }).standalone,
  );
  useEffect(() => {
    const request = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallEvent);
    };
    const complete = () => {
      setInstalled(true);
      setPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', request);
    window.addEventListener('appinstalled', complete);
    return () => {
      window.removeEventListener('beforeinstallprompt', request);
      window.removeEventListener('appinstalled', complete);
    };
  }, []);
  return {
    installed,
    available: !!prompt,
    async install() {
      if (!prompt) return;
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === 'accepted') setInstalled(true);
      setPrompt(null);
    },
  };
}
export function UpdatePrompt({ canReload }: { canReload: boolean }) {
  const {
    needRefresh: [ready],
    updateServiceWorker,
  } = useRegisterSW();
  if (!ready) return null;
  return (
    <div className="update" role="status">
      <div>
        <strong>Update available</strong>
        <p>
          {canReload
            ? 'Reload to get the latest version.'
            : 'Finish your current task before updating.'}
        </p>
      </div>
      <button
        className="button primary"
        disabled={!canReload}
        onClick={() => void updateServiceWorker(true)}
      >
        <RefreshCw size={17} /> Update
      </button>
    </div>
  );
}
export function InstallPanel({ install }: { install: ReturnType<typeof useInstall> }) {
  return (
    <section className="card stack">
      <h2>Install Renuka FieldForce</h2>
      {install.installed ? (
        <div className="success">
          <CheckCircle2 size={18} /> Installed on this device
        </div>
      ) : (
        <>
          {install.available && (
            <button className="button primary" onClick={() => void install.install()}>
              <Download size={18} /> Install app
            </button>
          )}
          <p>
            <strong>Android Chrome</strong> · Open the browser menu and choose Install app or Add to
            Home screen.
          </p>
          <p>
            <strong>iPhone Safari</strong> · Tap Share, then Add to Home Screen.
          </p>
        </>
      )}
    </section>
  );
}
