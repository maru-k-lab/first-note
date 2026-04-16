const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export interface NoteInfo {
  name: string;
  octave: number;
  label: string; // e.g. "A4"
}

/**
 * Convert a frequency in Hz to a musical note.
 * Verified: 440 Hz → A4, 261.63 Hz → C4, 523.25 Hz → C5
 */
export function frequencyToNote(hz: number): NoteInfo {
  const semitonesFromA4 = 12 * Math.log2(hz / 440);
  const rounded = Math.round(semitonesFromA4);
  // Offset by +9 because A is the 9th note (0-indexed) in C-based ordering
  const noteIndex = ((rounded % 12) + 12 + 9) % 12;
  const octave = Math.floor((rounded + 9) / 12) + 4;
  const name = NOTE_NAMES[noteIndex];
  return { name, octave, label: `${name}${octave}` };
}
