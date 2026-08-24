import React from 'react';
import type { Dict } from '../i18n';

interface ErrorBoundaryProps {
  t: Dict;
  children: React.ReactNode;
}

/**
 * Keeps one broken screen from taking the whole app down.
 *
 * Without a boundary React unmounts the entire tree when any component throws during
 * render, and the reader gets a white page with nothing on it — the worst possible
 * outcome for something consulted standing at a stop, because it offers no way forward
 * at all. This catches the throw, keeps the shell and its navigation alive, and says
 * what happened plus where the official timetable is.
 *
 * It has to be a class: `componentDidCatch` has no hook equivalent.
 *
 * Reset on navigation is deliberate. The boundary is placed around the content area, so
 * changing section remounts it with a fresh `key` and the reader is not stuck on the
 * error screen after moving somewhere that works.
 */
interface ErrorBoundaryState {
  failed: boolean;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // No telemetry to send it to, so the console is where a developer will find it.
    console.error('A view failed to render:', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    const { t } = this.props;
    return (
      <div className="mx-auto w-full max-w-3xl px-3.5 py-8" role="alert">
        <h2 className="text-title font-semibold tracking-[-0.012em]">{t.error.title}</h2>
        <p className="mt-2 text-body leading-relaxed text-ink-2">{t.error.body}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={() => window.location.reload()}
            className="flex h-11 items-center rounded-[10px] bg-accent px-4 text-body font-semibold text-on-accent"
          >
            {t.error.reload}
          </button>
          <a
            href="https://buslugo.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-11 items-center rounded-[10px] border border-edge px-4 text-body font-semibold text-accent"
          >
            {t.error.official}
          </a>
        </div>
      </div>
    );
  }
}
