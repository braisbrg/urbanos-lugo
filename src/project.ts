/**
 * Where this project lives, in one place: the "this pole is in the wrong place" link and
 * the User-Agent the alert fetcher sends both point here, and a test asserts nothing else
 * hardcodes the URL.
 */
export const REPO_URL = 'https://github.com/braisbrg/urbanos-lugo';

/**
 * A prefilled issue: plain `issues/new` rather than an issue form, because the body is
 * already complete and somebody at a bus stop on their phone should not have to fill a
 * form to say a dot is on the wrong side of the road.
 */
export function newIssueUrl(title: string, body: string): string {
  return `${REPO_URL}/issues/new?${new URLSearchParams({ title, body }).toString()}`;
}
