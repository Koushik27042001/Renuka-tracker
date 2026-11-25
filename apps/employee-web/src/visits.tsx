import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Camera, ClipboardPlus, MapPin, ShieldCheck } from 'lucide-react';
import { visitInput, type CurrentAttendance, type Visit } from '@renuka/shared';
import { api, ApiError, post, visitDetail, visitHistory, visitImage } from './api';
import { captureFrame, locate } from './device';
import { enqueue } from './offline';
import { Alert, Loading, message, Pager, Pill, Resource, Title, useResource } from './ui';

const fields = [
  ['clientName', 'Client or site', 'Example: Eastern Logistics Depot', 120],
  ['purpose', 'Purpose', 'Example: Quarterly stock inspection', 240],
  ['contactName', 'Contact name', 'Full name', 120],
  ['contactPhone', 'Contact phone', 'Phone number', 25],
  ['remarks', 'Remarks', 'Summarize the visit outcome', 500],
  ['notes', 'Follow-up notes', 'Add any next steps', 1000],
] as const;

export function VisitList() {
  const [page, setPage] = useState(1);
  const state = useResource(() => visitHistory(page), [page]);
  return (
    <>
      <Title
        title="Field visits"
        description="Manage drafts and track submitted visits."
        action={
          <Link className="button primary" to="/visits/new">
            <ClipboardPlus size={18} /> New visit
          </Link>
        }
      />
      <Resource state={state}>
        {(data) => (
          <section className="card stack">
            {data.visits.length ? (
              <ul className="records">
                {data.visits.map((visit) => (
                  <li key={visit.id}>
                    <Link to={'/visits/' + visit.id}>
                      <span className="record-icon">
                        <MapPin size={20} />
                      </span>
                      <span className="record-copy">
                        <strong>{visit.clientName}</strong>
                        <span>
                          {visit.visitDate} · {visit.purpose}
                        </span>
                      </span>
                      <Pill value={visit.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty">
                <MapPin />
                <h2>No visits yet</h2>
                <p>Start a field visit during an active shift.</p>
              </div>
            )}
            <Pager page={page} hasNext={page * data.limit < data.total} setPage={setPage} />
          </section>
        )}
      </Resource>
    </>
  );
}

export function NewVisit({
  shift,
  owner,
  queueChanged,
}: {
  shift?: CurrentAttendance;
  owner: string;
  queueChanged: () => void;
}) {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const attempt = useRef<{ fingerprint: string; key: string } | undefined>(undefined);
  const active = shift?.attendance?.status === 'CHECKED_IN';
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || saved || !shift || !active) return;
    const data = new FormData(event.currentTarget);
    const result = visitInput.safeParse({
      ...Object.fromEntries(data),
      visitDate: shift.attendanceDate,
    });
    if (!result.success) {
      setError(
        result.error.issues
          .map((issue) => fields.find(([name]) => name === issue.path[0])?.[1] ?? 'Visit date')
          .join(', ') + ' needs a valid value.',
      );
      return;
    }
    const fingerprint = JSON.stringify(result.data);
    if (attempt.current?.fingerprint !== fingerprint)
      attempt.current = { fingerprint, key: crypto.randomUUID() };
    const { key } = attempt.current;
    setBusy(true);
    setError('');
    try {
      try {
        const { visit } = await api<{ visit: Visit }>('/visits', post({ ...result.data, key }));
        navigate('/visits/' + visit.id, { replace: true });
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 0) throw error;
        await enqueue(owner, result.data, key);
        setSaved(true);
        queueChanged();
      }
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Title
        title="New field visit"
        description={shift ? 'Business date · ' + shift.attendanceDate : undefined}
      />
      <form className="card stack form-card" onSubmit={submit}>
        <h2>Visit details</h2>
        {!active && (
          <p className="notice">
            An active shift is required to save a visit.{' '}
            <Link to="/attendance">Open attendance</Link>
          </p>
        )}
        <div className="fields">
          {fields.map(([name, label, placeholder, maxLength], index) => (
            <label key={name} className={index >= 4 ? 'full' : undefined}>
              {label}
              {index > 1 && <small>Optional</small>}
              {index >= 4 ? (
                <textarea
                  name={name}
                  rows={3}
                  placeholder={placeholder}
                  maxLength={maxLength}
                  disabled={saved}
                />
              ) : (
                <input
                  name={name}
                  type={name === 'contactPhone' ? 'tel' : 'text'}
                  placeholder={placeholder}
                  maxLength={maxLength}
                  required={index < 2}
                  disabled={saved}
                />
              )}
            </label>
          ))}
        </div>
        <Alert error={error} />
        {saved ? (
          <p className="success" role="status">
            Draft saved on this device. <Link to="/sync">View synchronization status</Link>
          </p>
        ) : (
          <button disabled={!active || busy} className="button primary">
            {busy ? 'Saving draft…' : 'Save visit draft'}
          </button>
        )}
      </form>
    </>
  );
}

function PrivatePhoto({
  evidence,
  onLoaded,
}: {
  evidence: NonNullable<Visit['evidence']>;
  onLoaded: () => void;
}) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    let objectUrl = '';
    void visitImage(evidence.id).then(
      (blob) => {
        if (!live) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      },
      (error) => {
        if (live) setError(message(error));
      },
    );
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [evidence.id, attempt]);
  if (error)
    return (
      <div className="stack">
        <Alert error={error} />
        <button
          className="button secondary"
          onClick={() => {
            setError('');
            setUrl('');
            setAttempt((value) => value + 1);
          }}
        >
          Reload photo
        </button>
      </div>
    );
  return url ? (
    <img
      className="evidence-image"
      src={url}
      onLoad={onLoaded}
      alt="Private visit selfie with GPS and address watermark"
      onError={() => setError('Could not display this photo.')}
    />
  ) : (
    <Loading label="Loading private photo…" />
  );
}

export function VisitDetails() {
  const { id = '' } = useParams();
  const state = useResource(() => visitDetail(id), [id]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [loadedEvidence, setLoadedEvidence] = useState('');
  const navigate = useNavigate();
  async function submit(id: string) {
    if (busy || !reviewed) return;
    setBusy(true);
    setError('');
    try {
      await api('/visits/' + id + '/submit', post({}));
      state.refresh();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  async function removePhoto(id: string) {
    if (busy || !window.confirm('Remove the saved photo and take another?')) return;
    setBusy(true);
    setError('');
    try {
      await api('/visits/' + id + '/evidence', { method: 'DELETE' });
      setReviewed(false);
      state.refresh();
      navigate('/visits/' + id + '/camera');
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Resource state={state}>
      {(visit) => (
        <>
          <Title
            title={visit.clientName}
            description={visit.code + ' · ' + visit.visitDate}
            action={<Pill value={visit.status} />}
          />
          <div className="split">
            <section className="card stack">
              <h2>Visit details</h2>
              <dl className="details">
                <div>
                  <dt>Purpose</dt>
                  <dd>{visit.purpose}</dd>
                </div>
                {visit.contactName && (
                  <div>
                    <dt>Contact</dt>
                    <dd>{visit.contactName}</dd>
                  </div>
                )}
                {visit.contactPhone && (
                  <div>
                    <dt>Phone</dt>
                    <dd>{visit.contactPhone}</dd>
                  </div>
                )}
                {visit.remarks && (
                  <div>
                    <dt>Remarks</dt>
                    <dd>{visit.remarks}</dd>
                  </div>
                )}
                {visit.notes && (
                  <div>
                    <dt>Notes</dt>
                    <dd>{visit.notes}</dd>
                  </div>
                )}
                {visit.reason && (
                  <div>
                    <dt>Reviewer comment</dt>
                    <dd>{visit.reason}</dd>
                  </div>
                )}
              </dl>
            </section>
            <section className="card stack">
              <h2>Visit evidence</h2>
              {visit.evidence ? (
                <>
                  <PrivatePhoto
                    key={visit.evidence.id}
                    evidence={visit.evidence}
                    onLoaded={() => setLoadedEvidence(visit.evidence!.id)}
                  />
                  <div className="notice">
                    <strong>
                      {visit.evidence.accuracy > 50 ? 'Approximate area' : 'Mapped address'}
                    </strong>
                    <p>{visit.evidence.address ?? 'Address unavailable'}</p>
                    <p>GPS accuracy ±{Math.round(visit.evidence.accuracy)} m</p>
                  </div>
                </>
              ) : (
                <p>A GPS-verified selfie is required before you can submit the visit.</p>
              )}
              {visit.status === 'DRAFT' &&
                (visit.evidence ? (
                  <>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={reviewed}
                        disabled={loadedEvidence !== visit.evidence.id}
                        onChange={(event) => setReviewed(event.target.checked)}
                      />{' '}
                      I reviewed the photo and GPS watermark
                    </label>
                    <button
                      className="button primary"
                      disabled={busy || !reviewed || loadedEvidence !== visit.evidence.id}
                      onClick={() => void submit(visit.id)}
                    >
                      <ShieldCheck size={18} /> {busy ? 'Working…' : 'Submit for review'}
                    </button>
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => void removePhoto(visit.id)}
                    >
                      Replace photo
                    </button>
                  </>
                ) : (
                  <Link className="button primary" to={'/visits/' + visit.id + '/camera'}>
                    <Camera size={18} /> Open selfie capture
                  </Link>
                ))}
              <Alert error={error} />
            </section>
          </div>
        </>
      )}
    </Resource>
  );
}

export function VisitCamera({ shift }: { shift?: CurrentAttendance }) {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const visit = useResource(() => visitDetail(id), [id]);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const mounted = useRef(true);
  const generation = useRef(0);
  const [lifecycle] = useState(() => new AbortController());
  const lock = useRef(false);
  const [preview, setPreview] = useState('');
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [evidence, setEvidence] = useState<{
    photo: Blob;
    location: Awaited<ReturnType<typeof locate>>;
    capturedAt: string;
    key: string;
  }>();
  useEffect(() => {
    mounted.current = true;
    function hide() {
      if (document.visibilityState === 'visible') return;
      generation.current++;
      stream.current?.getTracks().forEach((track) => track.stop());
      stream.current = null;
      setCamera(false);
    }
    document.addEventListener('visibilitychange', hide);
    return () => {
      mounted.current = false;
      lifecycle.abort();
      generation.current++;
      stream.current?.getTracks().forEach((track) => track.stop());
      document.removeEventListener('visibilitychange', hide);
    };
  }, [lifecycle]);
  useEffect(() => {
    if (!evidence) {
      setPreview('');
      return;
    }
    const url = URL.createObjectURL(evidence.photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [evidence]);
  async function act(label: string, work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setError('');
    setBusy(label);
    try {
      await work();
    } catch (error) {
      if (mounted.current) setError(message(error));
    } finally {
      lock.current = false;
      if (mounted.current) setBusy('');
    }
  }
  const active =
    shift?.attendance?.status === 'CHECKED_IN' &&
    visit.data?.status === 'DRAFT' &&
    !visit.data.evidence;
  function startCamera() {
    void act('Opening camera…', async () => {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error('Camera capture requires HTTPS and a supported browser.');
      setEvidence(undefined);
      const attempt = generation.current;
      const next = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'user' }, width: { ideal: 1280 }, height: { ideal: 1280 } },
      });
      if (!mounted.current || generation.current !== attempt || !video.current) {
        next.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = next;
      video.current.srcObject = next;
      try {
        await video.current.play();
      } catch (error) {
        next.getTracks().forEach((track) => track.stop());
        stream.current = null;
        throw error;
      }
      if (mounted.current && generation.current === attempt) setCamera(true);
    });
  }
  function capture() {
    void act('Verifying GPS…', async () => {
      if (!video.current || !shift) return;
      const photo = await captureFrame(video.current);
      const capturedAt = new Date().toISOString();
      stream.current?.getTracks().forEach((track) => track.stop());
      stream.current = null;
      video.current.srcObject = null;
      if (!mounted.current) return;
      setCamera(false);
      const location = await locate(shift.limits, lifecycle.signal);
      if (mounted.current) setEvidence({ photo, location, capturedAt, key: crypto.randomUUID() });
    });
  }
  function upload() {
    if (!evidence) return;
    void act('Uploading private photo…', async () => {
      const { photo, ...metadata } = evidence;
      const form = new FormData();
      form.append('metadata', JSON.stringify(metadata));
      form.append('image', photo, 'selfie.jpg');
      try {
        await api('/visits/' + id + '/evidence', { method: 'POST', body: form });
        if (mounted.current) navigate('/visits/' + id, { replace: true });
      } catch (error) {
        if (mounted.current && error instanceof ApiError && error.status === 422)
          setEvidence(undefined);
        throw error;
      }
    });
  }
  return (
    <>
      <Title
        title="Visit selfie"
        description={visit.data?.clientName}
        action={
          <Link className="button secondary" to={'/visits/' + id}>
            Back to visit
          </Link>
        }
      />
      <section className="card stack camera-card">
        <h2>{evidence ? 'GPS verified' : 'Capture evidence'}</h2>
        <p>
          {evidence
            ? 'Check the selfie before uploading. The server adds the GPS and address watermark.'
            : 'Open the front camera, take a selfie, and confirm your current location.'}
        </p>
        <video
          ref={video}
          hidden={!camera}
          muted
          playsInline
          className="evidence-image"
          aria-label="Camera preview"
        />
        {preview && <img className="evidence-image" src={preview} alt="Selfie preview" />}
        {evidence && (
          <div className="notice">
            <MapPin size={18} /> GPS accuracy ±{Math.round(evidence.location.accuracy)} m
          </div>
        )}
        <Alert error={error || visit.error} />
        {busy && <Loading label={busy} />}
        {!active && !visit.error && !visit.data && <Loading label="Loading visit…" />}
        {!active && visit.data && (
          <p className="notice">
            Open a draft without a saved photo during an active shift to capture evidence.
          </p>
        )}
        <div className="actions">
          {camera ? (
            <button className="button primary" disabled={!!busy || !active} onClick={capture}>
              <Camera size={18} /> Take selfie
            </button>
          ) : (
            <button
              className={'button ' + (evidence ? 'secondary' : 'primary')}
              disabled={!!busy || !active}
              onClick={startCamera}
            >
              <Camera size={18} />
              {evidence ? 'Retake selfie' : 'Open front camera'}
            </button>
          )}
          {evidence && (
            <button className="button primary" disabled={!!busy || !active} onClick={upload}>
              Upload and preview watermark
            </button>
          )}
        </div>
      </section>
    </>
  );
}
