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
 * This gives them the four things that fixes:
 *
 * - **Escape closes.** The one shortcut everybody already knows.
 * - **Focus moves in** on open, so the next Tab lands inside the overlay.
 * - **Focus stays in.** Tab past the last control wraps to the first, and Shift+Tab
 *   the other way. Without this, `aria-modal` hid the page from a screen reader while
 *   the keyboard walked straight out into it: with the menu open, fourteen presses put
 *   focus on the QR button behind the drawer, still open, and Enter would have opened
 *   the scanner on top of it.
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

    // What the keyboard can reach inside, in document order. Visible only: the map's
    // control sheet keeps parts of itself `hidden` by breakpoint, and a scrim with
    // `tabIndex={-1}` is for the pointer, not the Tab key.
    const focusables = () =>
      [
        ...(containerRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]',
        ) ?? []),
      ].filter((el) => el.tabIndex >= 0 && !el.matches(':disabled') && el.getClientRects().length > 0);

    // The first thing inside that can take focus. Without `preventScroll`, focusing a
    // button in the map's stop sheet while the sheet is still sliding up from below the
    // map's edge scrolled the map's own `overflow: hidden` box to reach it, and the map
    // jumped up by the height of the sheet.
    focusables()[0]?.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) return;
      const active = document.activeElement;
      const edge = event.shiftKey ? items[0] : items[items.length - 1];
      if (active === edge || !containerRef.current?.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? items[items.length - 1] : items[0]).focus();
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
