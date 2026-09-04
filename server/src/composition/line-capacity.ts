/**
 * Return the number of complete line boxes that fit in a vertical interval.
 *
 * Template geometry is assembled from normalized fractions and can therefore
 * land a few floating-point ULPs below an exact line boundary. The small
 * tolerance keeps an intended boundary closed without changing ordinary
 * measurements.
 */
export function availableLineCount(height: number, leading: number): number {
  const roundingUlps = 1024;
  return Math.max(0, Math.floor(height / leading + Number.EPSILON * roundingUlps));
}
