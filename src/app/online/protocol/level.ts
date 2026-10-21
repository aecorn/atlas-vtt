/**
 * What this GM side can serve a player page. Raise it, with a line below, whenever the GM learns
 * something a player page will rely on; the relay's minimum may then follow, once an Atlas with the
 * new level is published.
 *
 * 1: everything up to the campaign players' codes (2026-10-18).
 * 2: rest requests from a player character's recovery buttons (`book-rest`, `book-rest-answer`) and the `rest` log entry (2026-10-20).
 * 3: rest steps: actions picked in a rest, for oneself or another character (2026-10-20).
 */
export const GM_LEVEL = 3;

/** The level of a GM that names none: one from before levels, which serves level 1. */
export const UNNAMED_GM_LEVEL = 1;

const MAX_LEVEL = 10_000;

/** A level as sent: a whole number from 0 to 10,000; anything else is 0. */
export function readLevel(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_LEVEL ? value : 0;
}

/** The level a frame names in `field`, or that of a GM that names none. */
export function levelIn(value: Readonly<Record<string, unknown>>, field: string): number {
  return value[field] === undefined ? UNNAMED_GM_LEVEL : readLevel(value[field]);
}
