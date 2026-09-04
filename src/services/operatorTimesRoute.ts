import { findStop } from '../utils/transitEngine';
import { poleCode } from '../data/transitData';
import { operatorTimesForStop } from './operatorTimes';

/**
 * What to answer when somebody asks for the operator's own minutes at a stop.
 *
 * The express route and the Deno worker both serve this, and both had their own copy of
 * the same four steps and the same three error strings. Two servers answering the same
 * question have to answer it the same way — a 404 here and a 502 there for the same input
 * is a bug nobody would notice until the app behaved differently depending on which
 * deployment it was talking to.
 *
 * The decision is shared; emitting it is not. Express wants `res.status().json()` and the
 * worker wants a `Response` with its own cache headers, so this returns the status and the
 * body and lets each one write it out.
 */
export async function operatorTimesResponse(
  rawCode: string,
): Promise<{ status: number; body: unknown }> {
  // Only stops this app knows about. Without this anybody could use either deployment to
  // fire arbitrary codes at the operator's site, which is both rude and pointless: a code
  // we cannot resolve is a code they cannot either.
  const stop = findStop(rawCode);
  if (!stop) return { status: 404, body: { error: 'Unknown stop' } };

  const code = poleCode(stop);
  if (!code) return { status: 404, body: { error: 'That stop has no operator code' } };

  const times = await operatorTimesForStop(code);
  // Null means their page could not be read, which is not the same as no buses coming.
  // 502 rather than an empty list, so the app shows only its own estimates.
  if (!times) return { status: 502, body: { error: 'The operator could not be read' } };

  return { status: 200, body: times };
}
