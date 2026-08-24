/**
 * HTML-escape a value bound for a Leaflet popup or tooltip.
 *
 * Leaflet takes HTML strings, not React nodes, so anything interpolated into one is
 * live markup. Stop and line names come from a scraped source, which is exactly the
 * kind of input that should never be trusted to be inert.
 *
 * This lived as three identical private copies in RouteLayer, StopLayer and
 * VehicleLayer. Three copies of a security control is three chances for one of them to
 * quietly fall behind the others.
 */
export const escapeHtml = (value: string | null | undefined): string =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
  );
