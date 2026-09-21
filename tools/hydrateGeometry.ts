import { applyRouteGeometry, type RouteGeometry } from '../src/data/routeGeometry';
import { at, readJson } from './lib';

/**
 * Put the street geometry onto the lines, the way the browser does. The app loads
 * `route-geometry.json` as a lazy chunk; Node does not, so a tool that just imports
 * BUS_LINES gets directions with no `pathCoordinates`, and a geometry check against an
 * empty dataset passes without testing anything.
 */
export function hydrateGeometry(): void {
  applyRouteGeometry(readJson<RouteGeometry>(at('src/data/route-geometry.json')));
}
