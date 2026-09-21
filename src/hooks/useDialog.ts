import { useEffect, useRef } from 'react';

/**
 * The keyboard half of an overlay: Escape closes, focus moves in on open, Tab wraps
 * inside, and focus returns to the opener on close. Without the trap, `aria-modal` hid
 * the page from a screen reader while the keyboard walked straight out into it.
 * The container still needs `role="dialog"` and `aria-modal="true"` in the markup.
 */
export function useDialog(open: boolean, onClose: () => void) {
  const containerRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement;

    // Visible only: the map's sheet keeps parts of itself `hidden` by breakpoint.
    const focusables = () =>
      [...(containerRef.current?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]') ?? [])].filter(
        (el) => el.tabIndex >= 0 && !el.matches(':disabled') && el.getClientRects().length > 0,
      );
    // preventScroll: focusing a button in the map's stop sheet while it slides up scrolled the map's own overflow box, and the map jumped by the sheet's height.
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
      // Only take focus back if it is still inside the overlay being torn down.
      const active = document.activeElement;
      if (!active || active === document.body || containerRef.current?.contains(active)) {
        (openerRef.current as HTMLElement | null)?.focus?.();
      }
    };
  }, [open, onClose]);

  return containerRef;
}
