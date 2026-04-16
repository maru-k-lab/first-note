import { frequencyToNote } from '../utils/pitchToNote';

export interface MicDisplay {
  update: (hz: number | null) => void;
  show: () => void;
  hide: () => void;
}

export function setupMicDisplay(): MicDisplay {
  const section = document.getElementById('section-mic')!;
  const micNote = document.getElementById('mic-note')!;
  const micHz = document.getElementById('mic-hz')!;
  const micStatus = document.getElementById('mic-status')!;

  return {
    update(hz: number | null): void {
      if (hz === null) {
        micNote.textContent = '—';
        micHz.textContent = '—';
        micStatus.textContent = 'ピッチが検出できません';
      } else {
        const { label } = frequencyToNote(hz);
        micNote.textContent = label;
        micHz.textContent = `${hz.toFixed(1)} Hz`;
        micStatus.textContent = '';
      }
    },
    show(): void {
      section.classList.remove('hidden');
    },
    hide(): void {
      section.classList.add('hidden');
      micNote.textContent = '—';
      micHz.textContent = '—';
      micStatus.textContent = '';
    },
  };
}
