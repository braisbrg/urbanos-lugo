/**
 * Permanent notices about the city rather than today's incidents. The prose lives in the
 * dictionary, in this order; the ids, severities and affected lines are facts and stay here.
 * The date is when a person last checked them against their sources: a file cannot know
 * whether a terminus or a set of roadworks is still current. Move it forward only after
 * re-reading the sources; the Monday job asks for that every five weeks
 * (tools/checkNoticesReviewed.ts).
 */
export const NOTICE_META = [{ id: 'struct-2', severity: 'info' as const, linesAffected: ['7', '8', '9', '12'] }];
export const NOTICES_REVIEWED_ON = '2026-10-13';
