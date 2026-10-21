/**
 * The marker of the token whose turn it is: rings around the token, laid out in token-UI units
 * (`restingTokenUIScale`: 1 is one pixel beside a medium token on a 70 px grid). The values are
 * the look the online player page ports (docs/plans/2026-10-20-initiative-turn-look.md).
 */

/** One circle of the marker, stroked about `radius`. */
export interface MarkerStroke {
  readonly radius: number;
  readonly width: number;
  /** The accent, or a dark line that keeps the ring readable on a light map. */
  readonly ink: 'accent' | 'dark';
  readonly alpha: number;
}

/** Where the marker grows in from, and how long it takes (`$transition-slow`). */
export const MARKER_GROW_FROM = 0.85;
export const MARKER_GROW_MS = 300;

/**
 * The marker's strokes around a token whose outer edge (its ring, or its art without one) lies
 * `outerRadius` from its centre, at `unit` world pixels per UI unit: a dark hairline, the accent
 * ring and a faint halo outside it.
 */
export function turnMarkerStrokes(outerRadius: number, unit: number): MarkerStroke[] {
  return [
    { radius: outerRadius + 2.5 * unit, width: unit, ink: 'dark', alpha: 0.35 },
    { radius: outerRadius + 4.5 * unit, width: 3 * unit, ink: 'accent', alpha: 1 },
    { radius: outerRadius + 9 * unit, width: 6 * unit, ink: 'accent', alpha: 0.22 },
  ];
}

/** How far the marker reaches beyond the token's outer edge, in UI units: the halo's outer edge. */
export const MARKER_REACH_UNITS = 12;
