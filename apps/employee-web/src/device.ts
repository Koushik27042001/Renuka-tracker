import {
  attendanceLocation,
  type AttendanceLocation,
  type CurrentAttendance,
} from '@renuka/shared';

export function locate(
  limits: CurrentAttendance['limits'],
  signal?: AbortSignal,
): Promise<AttendanceLocation> {
  if (signal?.aborted) return Promise.reject(new Error('Location verification was canceled.'));
  if (!window.isSecureContext || !navigator.geolocation)
    return Promise.reject(new Error('Location requires a supported browser and HTTPS.'));
  if (document.visibilityState !== 'visible')
    return Promise.reject(new Error('Keep Renuka open while verifying your location.'));
  return new Promise((resolve, reject) => {
    let best: AttendanceLocation | undefined;
    let finished = false;
    const finish = (message?: string) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      navigator.geolocation.clearWatch(watch);
      document.removeEventListener('visibilitychange', visibility);
      signal?.removeEventListener('abort', cancel);
      if (message) reject(new Error(message));
      else if (best && Date.now() - Date.parse(best.capturedAt) <= limits.maximumAgeSeconds * 1000)
        resolve(best);
      else
        reject(new Error('No accurate GPS reading was received. Move to an open area and retry.'));
    };
    const visibility = () => {
      if (document.visibilityState !== 'visible')
        finish('Location verification stopped. Keep this page visible and retry.');
    };
    const cancel = () => finish('Location verification was canceled.');
    const timer = window.setTimeout(
      () => finish(),
      Math.min(15_000, limits.maximumAgeSeconds * 1000),
    );
    document.addEventListener('visibilitychange', visibility);
    signal?.addEventListener('abort', cancel, { once: true });
    const watch = navigator.geolocation.watchPosition(
      (position) => {
        const age = Date.now() - position.timestamp;
        if (
          finished ||
          !Number.isFinite(age) ||
          age < -5000 ||
          age > limits.maximumAgeSeconds * 1000
        )
          return;
        const { latitude, longitude, accuracy } = position.coords;
        const result = attendanceLocation.safeParse({
          latitude,
          longitude,
          accuracy,
          capturedAt: new Date(position.timestamp).toISOString(),
        });
        if (!result.success || accuracy > limits.maximumAccuracy) return;
        if (
          !best ||
          accuracy <= best.accuracy ||
          Date.now() - Date.parse(best.capturedAt) > limits.maximumAgeSeconds * 1000
        )
          best = result.data;
        if (accuracy <= limits.preferredAccuracy) finish();
      },
      (error) => {
        if (error.code === 1)
          finish('Allow precise location in your browser settings to continue.');
        else if (!best) finish('Location is unavailable. Turn on device location and retry.');
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    );
  });
}

export async function captureFrame(video: HTMLVideoElement) {
  if (!video.videoWidth || !video.videoHeight)
    throw new Error('Wait until the camera preview is visible.');
  const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext('2d');
  if (!context || Math.min(canvas.width, canvas.height) < 240)
    throw new Error('A higher-resolution camera is required for visit evidence.');
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not capture the selfie.'))),
      'image/jpeg',
      0.9,
    ),
  );
}
