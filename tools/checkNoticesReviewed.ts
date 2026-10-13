/**
 * The structural notices on the Avisos screen are written by hand, and a terminus or a fare
 * can change without anyone here hearing of it: on 13 October 2026 two of three turned out
 * wrong, the intermodal works long finished and a discount that was the social fare. So every
 * Monday the weekly job says so when the last review is more than five weeks old. It reads
 * the file only.
 *
 *   pnpm exec tsx tools/checkNoticesReviewed.ts
 */
import { pathToFileURL } from 'node:url';
import { NOTICES_REVIEWED_ON } from '../src/data/structuralNotices';

const DAY_MS = 24 * 60 * 60 * 1000;

/** More than 35 days since the review, the reminder; otherwise nothing is due. */
export function noticesReviewDue(reviewedOn: string, now: Date): string | null {
  const days = Math.floor((now.getTime() - new Date(`${reviewedOn}T00:00:00Z`).getTime()) / DAY_MS);
  if (days <= 35) return null;
  return (
    `The structural notices were last reviewed ${days} days ago (${reviewedOn}). Re-read each one ` +
    `against its sources, change or remove what is no longer true in src/i18n/{gl,es,en}.ts and ` +
    `src/data/structuralNotices.ts, then move NOTICES_REVIEWED_ON to the day of the review.`
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const due = noticesReviewDue(NOTICES_REVIEWED_ON, new Date());
  console.log(due ?? `Structural notices reviewed on ${NOTICES_REVIEWED_ON}; nothing due yet.`);
  if (due) process.exit(1);
}
