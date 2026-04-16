interface ReferenceCallbacks {
  onPlay: () => Promise<void>;
  onStop: () => void;
  onVolumeChange: (value: number) => void;
}

export interface ReferenceDisplay {
  showNote: (label: string, hz: number) => void;
  setPlayState: (playing: boolean) => void;
  hide: () => void;
}

export function setupReferenceDisplay(callbacks: ReferenceCallbacks): ReferenceDisplay {
  const section = document.getElementById('section-reference')!;
  const refNote = document.getElementById('ref-note')!;
  const refHz = document.getElementById('ref-hz')!;
  const btnPlay = document.getElementById('btn-play')!;
  const btnStop = document.getElementById('btn-stop')!;
  const volumeSlider = document.getElementById('volume-slider') as HTMLInputElement;

  btnPlay.addEventListener('click', () => {
    void callbacks.onPlay();
  });

  btnStop.addEventListener('click', () => {
    callbacks.onStop();
  });

  volumeSlider.addEventListener('input', () => {
    callbacks.onVolumeChange(volumeSlider.valueAsNumber / 100);
  });

  return {
    showNote(label: string, hz: number): void {
      refNote.textContent = label;
      refHz.textContent = `${hz.toFixed(1)} Hz`;
      section.classList.remove('hidden');
    },
    setPlayState(playing: boolean): void {
      btnPlay.classList.toggle('hidden', playing);
      btnStop.classList.toggle('hidden', !playing);
    },
    hide(): void {
      section.classList.add('hidden');
    },
  };
}
