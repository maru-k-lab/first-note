export interface Waveform {
  render(buffer: AudioBuffer): void;
  setSelection(startSec: number, endSec: number): void;
  clear(): void;
  readonly duration: number;
  getRect(): DOMRect;
}

export function setupWaveform(rootId: string): Waveform {
  const root = document.getElementById(rootId)!;
  const canvas = root.querySelector<HTMLCanvasElement>('[data-waveform]')!;
  const selectionEl = root.querySelector<HTMLElement>('[data-selection]')!;
  const ctx2d = canvas.getContext('2d')!;

  let lastBuffer: AudioBuffer | null = null;
  let selRafId: number | null = null;
  let pendingSel: { startSec: number; endSec: number } | null = null;

  function cssWidth(): number {
    return canvas.clientWidth || canvas.getBoundingClientRect().width;
  }

  function drawWaveform(buffer: AudioBuffer): void {
    const dpr = window.devicePixelRatio || 1;
    const cssW = cssWidth();
    const cssH = canvas.clientHeight || canvas.getBoundingClientRect().height;

    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);

    ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    ctx2d.fillStyle = '#0f172a';
    ctx2d.fillRect(0, 0, canvas.width, canvas.height);

    const data = buffer.getChannelData(0);
    const totalSamples = data.length;
    const physW = canvas.width;
    const physH = canvas.height;
    const midY = physH / 2;

    ctx2d.strokeStyle = '#818cf8';
    ctx2d.lineWidth = dpr;
    ctx2d.beginPath();

    for (let px = 0; px < physW; px++) {
      const startSample = Math.floor((px / physW) * totalSamples);
      const endSample = Math.floor(((px + 1) / physW) * totalSamples);
      let min = 0;
      let max = 0;
      for (let i = startSample; i < endSample; i++) {
        const v = data[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const yTop = midY - max * midY;
      const yBot = midY - min * midY;
      ctx2d.moveTo(px + 0.5, yTop);
      ctx2d.lineTo(px + 0.5, yBot === yTop ? yBot + dpr : yBot);
    }
    ctx2d.stroke();
  }

  function applySelection(startSec: number, endSec: number): void {
    const dur = lastBuffer?.duration ?? 1;
    const cssW = cssWidth();
    const leftPct = (startSec / dur) * cssW;
    const widthPct = ((endSec - startSec) / dur) * cssW;
    selectionEl.style.left = `${leftPct}px`;
    selectionEl.style.width = `${widthPct}px`;
  }

  // ResizeObserver で幅変化時に再描画
  const ro = new ResizeObserver(() => {
    if (lastBuffer) drawWaveform(lastBuffer);
    if (pendingSel) applySelection(pendingSel.startSec, pendingSel.endSec);
  });
  ro.observe(root);

  return {
    render(buffer: AudioBuffer): void {
      lastBuffer = buffer;
      drawWaveform(buffer);
      // 選択帯をリセット
      selectionEl.style.left = '0';
      selectionEl.style.width = '0';
      pendingSel = null;
    },

    setSelection(startSec: number, endSec: number): void {
      pendingSel = { startSec, endSec };
      if (selRafId !== null) return;
      selRafId = requestAnimationFrame(() => {
        selRafId = null;
        if (pendingSel && lastBuffer) {
          applySelection(pendingSel.startSec, pendingSel.endSec);
        }
      });
    },

    clear(): void {
      lastBuffer = null;
      ctx2d.clearRect(0, 0, canvas.width, canvas.height);
      selectionEl.style.left = '0';
      selectionEl.style.width = '0';
    },

    get duration(): number {
      return lastBuffer?.duration ?? 0;
    },

    getRect(): DOMRect {
      return canvas.getBoundingClientRect();
    },
  };
}
