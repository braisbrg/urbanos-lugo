import { useEffect, useRef } from 'react';

/**
 * The keyboard half of an overlay.
 *
 * The menu, the QR scanner and the favourites panel all cover the page, and all three
 * were plain `<div>`s: no Escape, no announced role, and focus left sitting on whatever
 * was behind them. Someone on a keyboard could open the menu and then have to tab
 * forward through the whole page to reach its close button; a screen reader would read
 * straight past it into content it was covering.
 *
 * This gives them the three things that fixes:
 *
 * - **Escape closes.** The one shortcut everybody already knows.
 * - **Focus moves in** on open, so the next Tab lands inside the overlay.
 * - **Focus returns** to whatever opened it on close, so the reader is put back where
 *   they were rather than at the top of the document.
 *
 * The container also needs `role="dialog"` and `aria-modal="true"` — those are markup,
 * so they stay at each call site where they are visible next to the label.
 */
export function useDialog(open: boolean, onClose: () => void) {
  const containerRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;

    openerRef.current = document.activeElement;

    // The first thing inside that can take focus; the container itself if there is none.
    const focusable = containerRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusable?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      // Only steal focus back if it is still inside the overlay being torn down —
      // otherwise a click elsewhere would get yanked away from wherever it landed.
      const active = document.activeElement;
      if (!active || active === document.body || containerRef.current?.contains(active)) {
        (openerRef.current as HTMLElement | null)?.focus?.();
      }
    };
  }, [open, onClose]);

  return containerRef;
}
