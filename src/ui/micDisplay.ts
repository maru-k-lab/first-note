import { frequencyToNote } from '../utils/pitchToNote';
import type { MicSignalState } from '../audio/microphone';

export interface MicDisplay {
  update: (hz: number | null, signal?: MicSignalState, level?: number) => void;
  show: () => void;
  hide: () => void;
}

export function setupMicDisplay(): MicDisplay {
  const section = document.getElementById('section-mic')!;
  const micNote = document.getElementById('mic-note')!;
  const micHz = document.getElementById('mic-hz')!;
  const micStatus = document.getElementById('mic-status')!;

  return {
    update(hz: number | null, signal: MicSignalState = 'unpitched', level = 0): void {
      const levelText = `入力 ${Math.round(level * 100)}%`;
      if (hz === null) {
        micNote.textContent = '—';
        micHz.textContent = '—';
        micStatus.textContent = signal === 'silent'
          ? `${levelText} / 音が小さいです`
          : `${levelText} / ピッチ検出中`;
      } else {
        const { label } = frequencyToNote(hz);
        micNote.textContent = label;
        micHz.textContent = `${hz.toFixed(1)} Hz`;
        micStatus.textContent = levelText;
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
