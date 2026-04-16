const MAX_CENTS = 50;

export interface TunerMeter {
  setCents: (cents: number | null) => void;
  show: () => void;
  hide: () => void;
}

export function setupTunerMeter(): TunerMeter {
  const section = document.getElementById('section-tuner')!;
  const container = document.getElementById('tuner-meter')!;

  container.innerHTML = `
    <div class="relative w-full h-12 bg-gray-800 rounded-lg overflow-hidden" data-track>
      <div class="absolute top-0 bottom-0 left-1/2 w-px bg-gray-600"></div>
    </div>
    <div class="flex justify-between text-xs text-gray-600 mt-1 px-0.5">
      <span>-50¢</span><span>0</span><span>+50¢</span>
    </div>
    <div data-label class="text-center mt-3 text-lg font-semibold h-7"></div>
  `;

  const track = container.querySelector<HTMLElement>('[data-track]')!;
  const label = container.querySelector<HTMLElement>('[data-label]')!;

  // Needle element: positioned via style.left, always centered on that point
  const needle = document.createElement('div');
  needle.style.cssText = [
    'position: absolute',
    'top: 4px',
    'bottom: 4px',
    'width: 4px',
    'border-radius: 2px',
    'transform: translateX(-50%)',
    'left: 50%',
    'transition: left 75ms ease, background-color 200ms ease',
    'background-color: #4b5563',
  ].join(';');
  track.appendChild(needle);

  function setCents(cents: number | null): void {
    if (cents === null) {
      needle.style.left = '50%';
      needle.style.backgroundColor = '#4b5563'; // gray-600
      label.textContent = '';
      label.style.color = '';
      return;
    }

    const clamped = Math.max(-MAX_CENTS, Math.min(MAX_CENTS, cents));
    // Map cents range [-50, +50] → left position [0%, 100%]
    needle.style.left = `${50 + clamped}%`;

    const abs = Math.abs(cents);
    if (abs <= 5) {
      needle.style.backgroundColor = '#22c55e'; // green-500
      label.textContent = '一致！';
      label.style.color = '#22c55e';
    } else if (abs <= 15) {
      needle.style.backgroundColor = '#facc15'; // yellow-400
      label.textContent = 'ほぼ一致';
      label.style.color = '#facc15';
    } else {
      needle.style.backgroundColor = '#ef4444'; // red-500
      label.textContent = `${cents > 0 ? '+' : ''}${cents} ¢`;
      label.style.color = '#ef4444';
    }
  }

  return {
    setCents,
    show(): void {
      section.classList.remove('hidden');
    },
    hide(): void {
      section.classList.add('hidden');
      setCents(null);
    },
  };
}
