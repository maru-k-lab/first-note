export interface Range {
  startSec: number;
  endSec: number;
}

export interface RangeSelectorOptions {
  rootId: string;
  onChange: (range: Range) => void;
  onChangeEnd?: (range: Range) => void;
  onUserChange?: (range: Range) => void;
}

export interface RangeSelector {
  reset(duration: number, initial?: Range): void;
  getRange(): Range;
  disable(disabled: boolean): void;
}

const MIN_RANGE_SEC = 0.05; // YIN 最低要件: 50ms
const DEFAULT_RANGE_SEC = 0.75;
const STEP_SEC = 0.01;      // 矢印キー: 10ms
const STEP_LARGE_SEC = 0.1; // Shift+矢印: 100ms

export function setupRangeSelector(opts: RangeSelectorOptions): RangeSelector {
  const root = document.getElementById(opts.rootId)!;
  const handleStart = root.querySelector<HTMLElement>('[data-handle-start]')!;
  const handleEnd = root.querySelector<HTMLElement>('[data-handle-end]')!;
  const rangeText = document.getElementById('range-text')!;

  let duration = 1;
  let startSec = 0;
  let rangeLengthSec = Math.min(DEFAULT_RANGE_SEC, duration);
  let endSec = rangeLengthSec;
  let dragging = false;
  let dragOffsetSec = rangeLengthSec / 2;
  let disabled = false;

  function clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v));
  }

  function secToLeft(sec: number): string {
    const rect = root.getBoundingClientRect();
    return `${(sec / duration) * rect.width}px`;
  }

  function updatePositions(): void {
    handleStart.style.left = secToLeft(startSec);
    handleEnd.style.left = secToLeft(endSec);

    // ARIA
    handleStart.setAttribute('aria-valuenow', startSec.toFixed(2));
    handleStart.setAttribute('aria-valuemin', '0');
    handleStart.setAttribute('aria-valuemax', duration.toFixed(2));
    handleEnd.setAttribute('aria-valuenow', endSec.toFixed(2));
    handleEnd.setAttribute('aria-valuemin', '0');
    handleEnd.setAttribute('aria-valuemax', duration.toFixed(2));

    // テキスト表示
    const len = endSec - startSec;
    rangeText.textContent = `${startSec.toFixed(2)}s – ${endSec.toFixed(2)}s (${len.toFixed(2)}s)`;
  }

  function notify(): void {
    opts.onChange({ startSec, endSec });
    updatePositions();
  }

  function notifyUser(): void {
    opts.onUserChange?.({ startSec, endSec });
  }

  function setStart(nextStartSec: number): void {
    startSec = clamp(nextStartSec, 0, Math.max(0, duration - rangeLengthSec));
    endSec = startSec + rangeLengthSec;
  }

  function clientXToSec(clientX: number): number {
    const rect = root.getBoundingClientRect();
    const x = clamp(clientX - rect.left, 0, rect.width);
    return (x / rect.width) * duration;
  }

  // PointerEvent ハンドラ
  function onPointerDown(e: PointerEvent): void {
    if (disabled) return;
    e.preventDefault();
    const sec = clientXToSec(e.clientX);
    const insideSelection = sec >= startSec && sec <= endSec;
    dragOffsetSec = insideSelection ? sec - startSec : rangeLengthSec / 2;
    dragging = true;
    root.setPointerCapture(e.pointerId);
    if (!insideSelection) {
      setStart(sec - dragOffsetSec);
      notify();
      notifyUser();
    }
  }

  function onPointerMove(e: PointerEvent): void {
    if (!dragging || disabled) return;
    setStart(clientXToSec(e.clientX) - dragOffsetSec);
    notify();
    notifyUser();
  }

  function onPointerUp(e: PointerEvent): void {
    if (!dragging) return;
    root.releasePointerCapture(e.pointerId);
    dragging = false;
    opts.onChangeEnd?.({ startSec, endSec });
  }

  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerup', onPointerUp);
  root.addEventListener('pointercancel', onPointerUp);

  // キーボード操作
  function onKeyDown(e: KeyboardEvent): void {
    if (disabled) return;
    const step = e.shiftKey ? STEP_LARGE_SEC : STEP_SEC;
    const direction =
      e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 :
      e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 :
      0;
    if (direction === 0) return;

    e.preventDefault();
    setStart(startSec + step * direction);
    notify();
    notifyUser();
    opts.onChangeEnd?.({ startSec, endSec });
  }

  handleStart.addEventListener('keydown', onKeyDown);
  handleEnd.addEventListener('keydown', onKeyDown);

  // ResizeObserver でリサイズ時に位置再計算
  const ro = new ResizeObserver(() => {
    updatePositions();
  });
  ro.observe(root);

  return {
    reset(dur: number, initial?: Range): void {
      duration = dur;
      startSec = initial?.startSec ?? 0;
      rangeLengthSec = Math.max(
        Math.min(initial ? initial.endSec - initial.startSec : DEFAULT_RANGE_SEC, dur),
        Math.min(MIN_RANGE_SEC, dur),
      );
      setStart(startSec);
      updatePositions();
      notify();
    },

    getRange(): Range {
      return { startSec, endSec };
    },

    disable(d: boolean): void {
      disabled = d;
      root.style.pointerEvents = d ? 'none' : 'auto';
    },
  };
}
