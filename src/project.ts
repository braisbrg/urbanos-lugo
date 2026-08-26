/**
 * Where this project lives, in one place.
 *
 * Two things point at it and would break quietly if the repository were renamed: the
 * "this pole is in the wrong place" link a reader opens from a stop's page, and the
 * User-Agent the alert fetcher sends to buslugo.com so the operator can see who is
 * asking and why. A test asserts nothing else hardcodes the URL.
 */
export const REPO_URL = 'https://github.com/braisbrg/urbanos-lugo';

/**
 * A prefilled issue.
 *
 * Deliberately a plain `issues/new` rather than an issue form: the body is already
 * complete — pole code, id and coordinates — and somebody standing at a bus stop on
 * their phone should not have to fill a form to say a dot is on the wrong side of the
 * road. `.github/ISSUE_TEMPLATE/config.yml` keeps blank issues enabled for this reason.
 */
export function newIssueUrl(title: string, body: string): string {
  return `${REPO_URL}/issues/new?${new URLSearchParams({ title, body }).toString()}`;
}
