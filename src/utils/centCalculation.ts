/**
 * Calculate the interval between two frequencies in cents.
 * Positive = input is higher than reference.
 * 1200 cents = 1 octave, 100 cents = 1 semitone.
 */
export function centsBetween(input: number, reference: number): number {
  return Math.round(1200 * Math.log2(input / reference));
}
