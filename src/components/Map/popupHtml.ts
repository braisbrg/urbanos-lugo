import { escapeHtml } from '../../utils/html';

/**
 * Leaflet popups live outside React, so their markup is strings: the tokens are read
 * through var() and every value that came from the dataset goes through escapeHtml.
 */

/** A line's number on its colour, the badge printed on the poles, as inline HTML. */
export const badgeHtml = (color: string, number: string): string =>
  `<span style="background-color:${escapeHtml(color)}; color:#fff; font-weight:700; font-size:12px; padding:3px 7px; border-radius:5px;">${escapeHtml(number)}</span>`;

/** The unstyled button a popup row is made of, with room for a real click handler after insertion. */
export const rowButtonStyle = 'display:flex; align-items:center; gap:8px; background:none; border:none; cursor:pointer; text-align:left; font-family:inherit;';

/**
 * Where a popup on the network map may sit. Leaflet pans the map to fit a popup inside its
 * edges, and on a phone the line chips and the buses' notice float over the top of the map
 * and the locate and controls buttons over its foot: a bus's popup opened under the notice,
 * which covered its close button (WCAG 2.5.8). These margins keep it clear of both.
 */
export const POPUP_CLEAR_OF_CONTROLS = { autoPanPaddingTopLeft: [12, 124] as [number, number], autoPanPaddingBottomRight: [12, 80] as [number, number] };

/** A popup's outer box. */
export const popupBox = (inner: string, minWidth = 200): string =>
  `<div style="min-width: ${minWidth}px; padding: 2px; font-family: var(--font-sans); color: var(--c-ink);">${inner}</div>`;
