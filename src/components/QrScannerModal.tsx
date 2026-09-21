import { useEffect, useRef, useState } from 'react';
import { QrCode, X, ArrowRight, Camera, CameraOff } from 'lucide-react';
import { MAX_QUERY_LENGTH } from '../utils/searchUtils';
import { useDialog } from '../hooks/useDialog';
import { useT } from '../i18n';
import { BusStop } from '../types';
import { BUS_STOPS } from '../data/transitData';
import { findStop } from '../utils/places';

interface QrScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectStop: (stop: BusStop) => void;
}

/** The browser's own BarcodeDetector (Chromium, where people actually scan a pole); elsewhere the manual entry is the whole feature. */
const hasBarcodeDetector = typeof window !== 'undefined' && 'BarcodeDetector' in window;

/** Pull a stop code out of whatever the QR encodes: a bare code, or a URL ending in one. */
function extractStopCode(raw: string): string {
  const text = raw.trim();
  try {
    const url = new URL(text);
    const fromQuery = url.searchParams.get('parada') || url.searchParams.get('stop') || url.searchParams.get('ps') || url.searchParams.get('qr');
    if (fromQuery) return fromQuery;
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length) return segments[segments.length - 1];
  } catch {
    // Not a URL; fall through to the raw text.
  }
  const parts = text.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : text;
}

export function QrScannerModal({ isOpen, onClose, onSelectStop }: QrScannerModalProps) {
  const t = useT();
  const [inputCode, setInputCode] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const dialogRef = useDialog(isOpen, onClose);

  const found = (stop: BusStop) => {
    onSelectStop(stop);
    onClose();
  };
  const lookup = (code = inputCode) => {
    const stop = findStop(extractStopCode(code));
    if (stop) found(stop);
    else setErrorMsg(t.qr.notFound);
  };
  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setIsScanning(false);
  };

  // Scan loop: runs only while the modal is open and the camera is on.
  useEffect(() => {
    if (!isScanning || !hasBarcodeDetector) return;
    let cancelled = false;
    let frame = 0;
    const detector = new BarcodeDetector({ formats: ['qr_code'] });
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (cancelled) return stream.getTracks().forEach((tr) => tr.stop());
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        const tick = async () => {
          if (cancelled || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            const stop = codes.length ? findStop(extractStopCode(codes[0].rawValue)) : undefined;
            if (stop) {
              stopCamera();
              return found(stop);
            }
          } catch {
            // A dropped frame is not worth aborting the scan.
          }
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      } catch {
        if (!cancelled) {
          setCameraError(t.qr.cameraDenied);
          setIsScanning(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [isScanning]);

  // Never leave the camera running behind a closed modal.
  useEffect(() => {
    if (!isOpen) stopCamera();
  }, [isOpen]);

  if (!isOpen) return null;

  // Example stops, from the data instead of ids that go stale; only ones that really carry a printed code.
  const demos = BUS_STOPS.filter((s) => s.officialToken)
    .sort((a, b) => b.lines.length - a.lines.length)
    .slice(0, 5);

  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t.qr.title} className="anim-fade-full fixed inset-0 z-[2000] overflow-y-auto bg-scrim flex items-center justify-center p-4">
      <div className="anim-scale-in bg-bg rounded-card max-w-lg w-full p-6 shadow-2xl border border-edge relative">
        <button
          onClick={() => {
            stopCamera();
            onClose();
          }}
          aria-label={t.qr.close}
          className="absolute top-3.5 right-3.5 flex h-11 w-11 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-surface hover:text-ink-2"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-control bg-accent text-on-accent flex items-center justify-center">
            <QrCode className="w-6 h-6" />
          </div>
          <div>
            <h2 className="font-bold text-emph text-ink uppercase tracking-tight">{t.qr.title}</h2>
            <p className="text-label text-ink-3 font-medium">{t.qr.subtitle}</p>
          </div>
        </div>

        {isScanning && (
          <div className="relative rounded-control overflow-hidden bg-ink mb-3 aspect-video">
            <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
            <div className="absolute inset-0 border-[3px] border-white/70 m-10 rounded-control pointer-events-none" />
            <span className="absolute bottom-2 inset-x-0 text-center text-label font-bold text-white drop-shadow">{t.qr.scanning}</span>
          </div>
        )}

        <button
          onClick={() => {
            setCameraError('');
            isScanning ? stopCamera() : setIsScanning(true);
          }}
          disabled={!hasBarcodeDetector}
          className="mb-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-edge bg-surface py-2.5 text-label font-bold uppercase tracking-wider text-ink transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
        >
          {hasBarcodeDetector ? <Camera className="w-4 h-4" /> : <CameraOff className="w-4 h-4" />}
          <span>{hasBarcodeDetector ? (isScanning ? t.qr.stopScan : t.qr.scanBtn) : t.qr.noCamera}</span>
        </button>
        {cameraError && <p className="text-label font-bold text-estimated px-1 mb-2">{cameraError}</p>}

        <div className="space-y-3">
          <input
            id="qr-manual-input"
            type="text"
            value={inputCode}
            onChange={(e) => {
              setInputCode(e.target.value);
              setErrorMsg('');
            }}
            onKeyDown={(e) => e.key === 'Enter' && lookup()}
            maxLength={MAX_QUERY_LENGTH}
            placeholder={t.qr.placeholder}
            className="min-h-11 w-full rounded-md border border-edge bg-surface px-3.5 py-2.5 text-body font-semibold text-ink placeholder:text-ink-3 focus:bg-bg focus:outline-none focus:ring-2 focus:ring-accent"
          />
          {errorMsg && <p className="text-label font-bold text-warn-ink px-1">{errorMsg}</p>}
          <button onClick={() => lookup()} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-accent py-2.5 text-label font-bold uppercase tracking-wider text-on-accent shadow-xs transition-all hover:bg-accent">
            <span>{t.qr.searchBtn}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-5 pt-4 border-t border-line">
          <span className="text-label font-bold text-ink-2 uppercase tracking-wider block mb-2">{t.qr.popularDemos}</span>
          <div className="space-y-1.5">
            {demos.map((stop) => (
              <button
                key={stop.id}
                onClick={() => {
                  setInputCode(stop.code);
                  lookup(stop.code);
                }}
                className="group flex min-h-11 w-full items-center justify-between gap-2 rounded-md border border-edge bg-surface p-2.5 text-left text-label transition-colors hover:bg-surface"
              >
                <span title={stop.name} className="font-semibold text-ink group-hover:text-accent truncate">
                  {stop.name}
                </span>
                <span className="font-mono text-accent font-bold shrink-0">{stop.code}</span>
              </button>
            ))}
          </div>
        </div>

        <p className="text-label text-ink-3 mt-4 leading-relaxed bg-surface p-3 rounded-md border border-line">{t.qr.howItWorks}</p>
      </div>
    </div>
  );
}
