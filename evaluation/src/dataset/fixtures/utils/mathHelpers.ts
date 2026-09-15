// Fixture file for DevForge's evaluation dataset (Phase 11). Small, synthetic,
// non-sensitive sample code written for this dataset — not copied from any
// real project. Deliberately clean: this file has no meaningful bugs,
// security issues, or reliability problems, so review evaluation can check
// that the system does not invent findings where none exist.

/**
 * Clamps a number to the inclusive [min, max] range.
 */
export function clamp(value: number, min: number, max: number): number {
  if (min > max) {
    throw new Error(`clamp: min (${min}) must not exceed max (${max})`);
  }
  return Math.min(Math.max(value, min), max);
}

/**
 * Computes the arithmetic mean of a non-empty array of numbers.
 */
export function mean(values: number[]): number {
  if (values.length === 0) {
    throw new Error("mean: values must not be empty");
  }
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Rounds a number to a fixed number of decimal places.
 */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
