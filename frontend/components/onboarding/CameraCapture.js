'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Spinner } from '@/components/ui';

const MAX_SIDE = 1600; // px — keeps uploads well under the size limit
const JPEG_QUALITY = 0.9;

/** True when in-page camera capture is possible (secure context + getUserMedia). */
export function cameraSupported() {
  return typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;
}

/**
 * Full-screen camera capture modal.
 * mode="face": front camera, mirrored preview, oval face guide (profile photo).
 * mode="document": rear camera, card-shaped guide (ID / address documents).
 * Calls onCapture(File) with a JPEG when the user confirms.
 */
export default function CameraCapture({ mode = 'document', title, onCapture, onClose }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [facing, setFacing] = useState(mode === 'face' ? 'user' : 'environment');
  const [state, setState] = useState('starting'); // starting | live | captured | error
  const [error, setError] = useState('');
  const [shot, setShot] = useState(null); // { url, blob }
  const [canSwitch, setCanSwitch] = useState(false);
  const mirrored = facing === 'user';

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async () => {
    stop();
    setState('starting');
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      setCanSwitch(devices.filter((d) => d.kind === 'videoinput').length > 1);
      setState('live');
    } catch (e) {
      const denied = e?.name === 'NotAllowedError' || e?.name === 'SecurityError';
      setError(
        denied
          ? 'Camera access was blocked. Allow camera permission for this site in your browser settings, or upload a file instead.'
          : e?.name === 'NotFoundError'
            ? 'No camera was found on this device. Please upload a file instead.'
            : 'Could not start the camera. Please try again or upload a file instead.',
      );
      setState('error');
    }
  }, [facing, stop]);

  useEffect(() => {
    start();
    return stop;
  }, [start, stop]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => () => shot && URL.revokeObjectURL(shot.url), [shot]);

  function capture() {
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    // Source region: selfies are centre-cropped to a 3:4 portrait around the oval guide;
    // documents keep the full frame so no edge of the card is cut off.
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    let sx = 0;
    let sy = 0;
    let sw = vw;
    let sh = vh;
    if (mode === 'face') {
      const target = 3 / 4;
      if (vw / vh > target) {
        sw = Math.round(vh * target);
        sx = Math.round((vw - sw) / 2);
      } else {
        sh = Math.round(vw / target);
        sy = Math.round((vh - sh) / 2);
      }
    }
    const scale = Math.min(1, MAX_SIDE / Math.max(sw, sh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(sw * scale);
    canvas.height = Math.round(sh * scale);
    const ctx = canvas.getContext('2d');
    if (mirrored) {
      // Save the selfie the way the user saw it in the preview.
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return setError('Could not capture the photo. Please try again.');
        setShot({ url: URL.createObjectURL(blob), blob });
        setState('captured');
        stop();
      },
      'image/jpeg',
      JPEG_QUALITY,
    );
  }

  function retake() {
    setShot(null);
    start();
  }

  function usePhoto() {
    const name = `${mode === 'face' ? 'profile-photo' : 'document'}-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`;
    onCapture(new File([shot.blob], name, { type: 'image/jpeg' }));
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black text-white" role="dialog" aria-modal="true" aria-label={title}>
      <div className="flex items-center justify-between px-4 py-3">
        <p className="font-semibold">{title}</p>
        <button type="button" onClick={onClose} className="rounded-full p-2 text-white/80 hover:bg-white/10" aria-label="Close camera">
          ✕
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        {state !== 'captured' && (
          <video
            ref={videoRef}
            playsInline
            muted
            className={`absolute inset-0 h-full w-full object-cover ${mirrored ? '-scale-x-100' : ''}`}
            aria-label="Camera preview"
          />
        )}
        {state === 'captured' && shot && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shot.url} alt="Captured photo preview" className="absolute inset-0 h-full w-full object-contain" />
        )}

        {/* Framing guide */}
        {state === 'live' && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
            {mode === 'face' ? (
              <div className="aspect-[3/4] w-[62%] max-w-xs rounded-[50%] border-4 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
            ) : (
              <div className="aspect-[1.586] w-[86%] max-w-xl rounded-2xl border-4 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
            )}
          </div>
        )}
        {state === 'live' && (
          <p className="absolute inset-x-0 bottom-4 px-6 text-center text-sm font-medium text-white drop-shadow">
            {mode === 'face' ? 'Face the camera in good light and fit your face inside the oval.' : 'Place the document flat inside the frame. Avoid glare and make sure all text is readable.'}
          </p>
        )}
        {state === 'starting' && (
          <div className="absolute inset-0 flex items-center justify-center gap-3 text-white/80">
            <Spinner className="h-5 w-5" /> Starting camera…
          </div>
        )}
        {state === 'error' && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <Alert tone="error" className="max-w-sm">
              {error}
            </Alert>
          </div>
        )}
      </div>

      <div className="flex items-center justify-center gap-4 px-4 py-5">
        {state === 'live' && (
          <>
            {canSwitch ? (
              <button type="button" onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))} className="rounded-full bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/20">
                Switch camera
              </button>
            ) : (
              <span className="w-[118px]" />
            )}
            <button type="button" onClick={capture} className="grid h-16 w-16 place-items-center rounded-full border-4 border-white bg-white/20 hover:bg-white/30" aria-label="Take photo">
              <span className="h-11 w-11 rounded-full bg-white" />
            </button>
            <span className="w-[118px]" />
          </>
        )}
        {state === 'captured' && (
          <>
            <Button variant="secondary" onClick={retake}>
              Retake
            </Button>
            <Button onClick={usePhoto}>Use photo</Button>
          </>
        )}
        {state === 'error' && (
          <>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button onClick={start}>Try again</Button>
          </>
        )}
      </div>
    </div>
  );
}
